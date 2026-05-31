const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { getClient, destroyClient, getDefaultDownloadPath } = require('./client');
const { buildFileTree, refreshFileTreeVolatile } = require('./file-tree');

const METADATA_TIMEOUT_MS = 120_000;
const MIN_FREE_BYTES = 50 * 1024 * 1024; // 50 MB headroom

/** @typedef {'downloading'|'paused'|'seeding'|'done'} TorrentStatus */

class TorrentError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Error} [cause]
   */
  constructor(code, message, cause) {
    super(message);
    this.name = 'TorrentError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

class TorrentManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, import('webtorrent').default.Torrent>} */
    this._active = new Map();
    /**
     * Cached file trees keyed by infoHash.
     * @type {Map<string, { root: object, leaves: object[], selection: Uint8Array }>}
     */
    this._fileTreeCache = new Map();
    /** @type {ReturnType<typeof setInterval> | null} */
    this._pollTimer = null;
    this._ready = false;
  }

  async init() {
    const downloadPath = getDefaultDownloadPath();
    await this._ensureDownloadDir(downloadPath);
    await getClient();
    this._startPolling();
    this._ready = true;
  }

  /**
   * Add a torrent from a magnet URI or a .torrent file path.
   *
   * @param {string} torrentId - magnet:?xt=… or absolute path to a .torrent file
   * @param {string} [downloadPath] - destination directory (defaults to ~/Downloads/MyTorrent)
   * @returns {Promise<object>} stats snapshot for the newly added torrent
   */
  async addTorrent(torrentId, downloadPath) {
    this._assertReady();

    if (!torrentId || typeof torrentId !== 'string') {
      throw new TorrentError('INVALID_INPUT', 'torrentId phải là chuỗi không rỗng');
    }

    const trimmed = torrentId.trim();
    const targetPath = downloadPath || getDefaultDownloadPath();

    await this._ensureDownloadDir(targetPath);
    await this._assertDiskSpace(targetPath);

    const source = await this._resolveTorrentSource(trimmed);
    const client = await getClient();

    return new Promise((resolve, reject) => {
      let settled = false;
      let torrentRef = null;

      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (torrentRef?.infoHash) {
          client.remove(torrentRef.infoHash, { destroyStore: true }, () => {});
          this._active.delete(torrentRef.infoHash);
        }

        const classified = this._classifyError(err);
        this.emit('error', {
          infoHash: torrentRef?.infoHash ?? null,
          code: classified.code,
          message: classified.message,
        });
        reject(classified);
      };

      const timer = setTimeout(() => {
        fail(new TorrentError('METADATA_TIMEOUT', 'Hết thời gian chờ metadata torrent (magnet link có thể không hợp lệ)'));
      }, METADATA_TIMEOUT_MS);

      try {
        torrentRef = client.add(source, { path: targetPath }, (added) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);

          this._active.set(added.infoHash, added);

          const stats = this._buildStats(added);
          this.emit('added', stats);
          resolve(stats);
        });

        this._bindTorrentEvents(torrentRef);
        torrentRef.on('error', fail);
      } catch (err) {
        fail(err);
      }
    });
  }

  /**
   * @param {string} infoHash
   */
  async pauseTorrent(infoHash) {
    this._assertReady();
    const torrent = await this._getTorrentOrThrow(infoHash);
    torrent.pause();
    return this._buildStats(torrent);
  }

  /**
   * @param {string} infoHash
   */
  async resumeTorrent(infoHash) {
    this._assertReady();
    const torrent = await this._getTorrentOrThrow(infoHash);
    torrent.resume();
    return this._buildStats(torrent);
  }

  /**
   * Remove a torrent from the active list.
   *
   * @param {string} infoHash
   * @param {boolean} [deleteFiles=false] - when true, delete downloaded files from disk
   */
  async removeTorrent(infoHash, deleteFiles = false) {
    this._assertReady();

    const client = await getClient();
    const torrent = client.get(infoHash);

    if (!torrent) {
      throw new TorrentError('NOT_FOUND', `Không tìm thấy torrent: ${infoHash}`);
    }

    const savedPaths = torrent.files.map((f) => f.path);
    const savedRoot = torrent.path;

    await new Promise((resolve, reject) => {
      client.remove(infoHash, { destroyStore: false }, (err) => {
        if (err) reject(this._classifyError(err));
        else resolve();
      });
    });

    this._active.delete(infoHash);
    this._fileTreeCache.delete(infoHash);

    if (deleteFiles) {
      await this._deleteFilesFromDisk(savedPaths, savedRoot);
    }

    this.emit('removed', infoHash);
    return { ok: true, infoHash, deleteFiles };
  }

  /**
   * Return stats for every active torrent (for UI sync).
   * @returns {Promise<Array<{
   *   infoHash: string,
   *   name: string,
   *   progress: number,
   *   downloadSpeed: number,
   *   uploadSpeed: number,
   *   numPeers: number,
   *   status: TorrentStatus,
   *   eta: number | null,
   *   length: number,
   *   path: string,
   * }>>}
   */
  async getTorrentStats() {
    this._assertReady();
    const client = await getClient();
    return client.torrents.map((t) => this._buildStats(t));
  }

  /**
   * Return the cached file tree for a torrent (built on metadata).
   * Volatile fields (selected, progress) are refreshed in O(n) without rebuilding.
   *
   * @param {string} infoHash
   * @returns {Promise<object>} root directory node with nested children
   */
  async getFileTree(infoHash) {
    this._assertReady();
    const torrent = await this._getTorrentOrThrow(infoHash);

    let cache = this._fileTreeCache.get(infoHash);
    if (!cache) {
      if (!torrent.metadata) {
        throw new TorrentError('METADATA_NOT_READY', 'Metadata chưa sẵn sàng — thử lại sau vài giây');
      }
      cache = this._buildAndCacheFileTree(torrent);
    }

    refreshFileTreeVolatile(cache, torrent.files);
    return cache.root;
  }

  /**
   * Enable or disable downloading a specific file within a torrent.
   *
   * @param {string} infoHash
   * @param {number} fileIndex - index in torrent.files
   * @param {boolean} shouldDownload
   */
  async toggleFileSelection(infoHash, fileIndex, shouldDownload) {
    this._assertReady();

    if (!Number.isInteger(fileIndex) || fileIndex < 0) {
      throw new TorrentError('INVALID_FILE_INDEX', `fileIndex không hợp lệ: ${fileIndex}`);
    }

    const torrent = await this._getTorrentOrThrow(infoHash);

    if (fileIndex >= torrent.files.length) {
      throw new TorrentError(
        'INVALID_FILE_INDEX',
        `fileIndex ${fileIndex} vượt quá số file (${torrent.files.length})`
      );
    }

    const file = torrent.files[fileIndex];
    const cache = this._fileTreeCache.get(infoHash);

    if (shouldDownload) {
      file.select();
    } else {
      file.deselect();
    }

    if (cache) {
      cache.selection[fileIndex] = shouldDownload ? 1 : 0;
      cache.leaves[fileIndex].selected = shouldDownload;
    }

    const payload = { infoHash, fileIndex, selected: shouldDownload };
    this.emit('file-selection-changed', payload);
    return payload;
  }

  destroy() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this._active.clear();
    this._fileTreeCache.clear();
    destroyClient();
    this._ready = false;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  _assertReady() {
    if (!this._ready) {
      throw new TorrentError('NOT_INITIALIZED', 'TorrentManager chưa được khởi tạo — gọi init() trước');
    }
  }

  _getTorrentOrThrow(infoHash) {
    return getClient().then((client) => {
      const torrent = client.get(infoHash);
      if (!torrent) {
        throw new TorrentError('NOT_FOUND', `Không tìm thấy torrent: ${infoHash}`);
      }
      return torrent;
    });
  }

  async _resolveTorrentSource(torrentId) {
    if (torrentId.startsWith('magnet:?')) {
      if (!torrentId.includes('xt=urn:btih:')) {
        throw new TorrentError('INVALID_MAGNET', 'Magnet link không hợp lệ — thiếu info-hash (xt=urn:btih:…)');
      }
      return torrentId;
    }

    const resolved = path.resolve(torrentId);

    try {
      await fs.promises.access(resolved, fs.constants.R_OK);
    } catch {
      throw new TorrentError('FILE_NOT_FOUND', `Không đọc được file .torrent: ${resolved}`);
    }

    if (!resolved.toLowerCase().endsWith('.torrent')) {
      throw new TorrentError('INVALID_TORRENT_FILE', 'File phải có phần mở rộng .torrent');
    }

    return resolved;
  }

  async _ensureDownloadDir(dirPath) {
    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
    } catch (err) {
      throw this._classifyError(err, `Không thể tạo thư mục tải về: ${dirPath}`);
    }
  }

  async _assertDiskSpace(dirPath) {
    try {
      if (typeof fs.promises.statfs !== 'function') return;

      const stats = await fs.promises.statfs(dirPath);
      const freeBytes = stats.bsize * stats.bavail;

      if (freeBytes < MIN_FREE_BYTES) {
        throw new TorrentError(
          'DISK_FULL',
          `Ổ đĩa sắp hết dung lượng — còn ${Math.floor(freeBytes / 1024 / 1024)} MB`
        );
      }
    } catch (err) {
      if (err instanceof TorrentError) throw err;
      // statfs unavailable on some platforms — skip pre-check
    }
  }

  /**
   * @param {import('webtorrent').default.Torrent} torrent
   */
  _bindTorrentEvents(torrent) {
    torrent.on('error', (err) => {
      const classified = this._classifyError(err);
      this.emit('error', {
        infoHash: torrent.infoHash,
        code: classified.code,
        message: classified.message,
      });
    });

    torrent.on('metadata', () => {
      this._onMetadataReady(torrent);
    });

    if (torrent.metadata) {
      this._onMetadataReady(torrent);
    }

    torrent.on('done', async () => {
      this.emit('update', await this.getTorrentStats());
    });
  }

  /**
   * Build and cache the file tree when metadata arrives.
   * @param {import('webtorrent').default.Torrent} torrent
   */
  _onMetadataReady(torrent) {
    if (this._fileTreeCache.has(torrent.infoHash)) return;

    const cache = this._buildAndCacheFileTree(torrent);
    refreshFileTreeVolatile(cache, torrent.files);

    this.emit('metadata', {
      infoHash: torrent.infoHash,
      fileCount: torrent.files.length,
      tree: cache.root,
    });
  }

  /**
   * @param {import('webtorrent').default.Torrent} torrent
   * @returns {{ root: object, leaves: object[], selection: Uint8Array }}
   */
  _buildAndCacheFileTree(torrent) {
    const fileInputs = torrent.files.map((f) => ({ path: f.path, length: f.length }));
    const { root, leaves } = buildFileTree(fileInputs);

    const selection = new Uint8Array(torrent.files.length);
    selection.fill(1);

    const cache = { root, leaves, selection };
    this._fileTreeCache.set(torrent.infoHash, cache);
    return cache;
  }

  /**
   * @param {import('webtorrent').default.Torrent} torrent
   */
  _resolveStatus(torrent) {
    if (torrent.paused) {
      if (torrent.done || torrent.progress >= 1) return 'done';
      return 'paused';
    }
    if (torrent.done || torrent.progress >= 1) return 'seeding';
    return 'downloading';
  }

  /**
   * @param {import('webtorrent').default.Torrent} torrent
   */
  _buildStats(torrent) {
    const done = torrent.done || torrent.progress >= 1;
    const eta = done ? null : (Number.isFinite(torrent.timeRemaining) ? torrent.timeRemaining : null);

    return {
      infoHash: torrent.infoHash,
      name: torrent.name || 'Đang tải metadata…',
      progress: Math.round(torrent.progress * 1000) / 10,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      numPeers: torrent.numPeers,
      status: this._resolveStatus(torrent),
      eta,
      length: torrent.length,
      path: torrent.path,
    };
  }

  /**
   * @param {string[]} filePaths
   * @param {string} rootPath
   */
  async _deleteFilesFromDisk(filePaths, rootPath) {
    const errors = [];

    for (const filePath of filePaths) {
      try {
        await fs.promises.rm(filePath, { force: true });
      } catch (err) {
        errors.push({ filePath, err });
      }
    }

    if (rootPath) {
      try {
        await fs.promises.rm(rootPath, { recursive: true, force: true });
      } catch (err) {
        if (err.code !== 'ENOENT') {
          errors.push({ filePath: rootPath, err });
        }
      }
    }

    if (errors.length > 0) {
      const detail = errors.map(({ filePath, err }) => `${filePath}: ${err.message}`).join('; ');
      throw new TorrentError('DELETE_FAILED', `Không thể xóa một số file: ${detail}`, errors[0].err);
    }
  }

  /**
   * @param {Error} err
   * @param {string} [context]
   */
  _classifyError(err, context) {
    const code = err.code || err.errno;
    const message = err.message || String(err);

    if (code === 'ENOSPC' || code === 'EDQUOT' || /no space left/i.test(message)) {
      return new TorrentError(
        'DISK_FULL',
        context || 'Ổ đĩa hết dung lượng — không thể ghi file torrent',
        err
      );
    }

    if (code === 'EACCES' || code === 'EPERM') {
      return new TorrentError(
        'PERMISSION_DENIED',
        context || 'Không có quyền truy cập thư mục hoặc file',
        err
      );
    }

    if (/invalid magnet/i.test(message) || /invalid torrent/i.test(message)) {
      return new TorrentError('INVALID_MAGNET', context || 'Magnet link hoặc torrent không hợp lệ', err);
    }

    if (err instanceof TorrentError) return err;

    return new TorrentError('TORRENT_ERROR', context || message, err);
  }

  _startPolling() {
    this._pollTimer = setInterval(async () => {
      try {
        const stats = await this.getTorrentStats();
        this.emit('update', stats);
      } catch {
        // swallow polling errors — next tick will retry
      }
    }, 1000);
  }
}

const torrentManager = new TorrentManager();

module.exports = { TorrentManager, TorrentError, torrentManager };
