const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { getClient, destroyClient, getDefaultDownloadPath } = require('./client');
const { buildFileTree, refreshFileTreeVolatile } = require('./file-tree');
const { loadSession, saveSession } = require('./session-store');

const METADATA_TIMEOUT_MS = 120_000;
const RESTORE_METADATA_TIMEOUT_MS = 120_000;
const MIN_FREE_BYTES = 50 * 1024 * 1024; // 50 MB headroom
const SESSION_SAVE_DEBOUNCE_MS = 400;

/** @typedef {'downloading'|'paused'|'seeding'|'stopped'|'done'|'restoring'|'not_found'} TorrentStatus */

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
    /** @type {ReturnType<typeof setTimeout> | null} */
    this._sessionSaveTimer = null;
    /** Torrents đã dừng hẳn (không seed/upload) — vẫn giữ trong danh sách */
    /** @type {Set<string>} */
    this._stopped = new Set();
    /** infoHash → magnet URI hoặc đường dẫn .torrent gốc */
    /** @type {Map<string, string>} */
    this._torrentSources = new Map();
    /** Torrent không khôi phục được — hiển thị trên UI với status not_found */
    /** @type {Map<string, object>} */
    this._unavailable = new Map();
    /** infoHash đang khôi phục nền */
    /** @type {Set<string>} */
    this._restoring = new Set();
    /** @type {Map<string, object>} */
    this._restoringMeta = new Map();
    this._ready = false;
  }

  async init() {
    const downloadPath = getDefaultDownloadPath();
    await this._ensureDownloadDir(downloadPath);
    await getClient();
    this._ready = true;
    this._startPolling();
  }

  /** Khôi phục torrent từ session — chạy nền, không chặn mở cửa sổ */
  restoreSession() {
    return this._restoreSession();
  }

  /**
   * Add a torrent from a magnet URI or a .torrent file path.
   *
   * @param {string} torrentId - magnet:?xt=… or absolute path to a .torrent file
   * @param {string} [downloadPath] - destination directory (defaults to ~/Downloads/MyTorrent)
   * @returns {Promise<object>} stats snapshot for the newly added torrent
   */
  async addTorrent(torrentId, downloadPath) {
    if (!torrentId || typeof torrentId !== 'string') {
      throw new TorrentError('INVALID_INPUT', 'torrentId phải là chuỗi không rỗng');
    }

    try {
      const stats = await this._addTorrentWithOptions(torrentId.trim(), downloadPath);
      this.emit('added', stats);
      this._scheduleSessionSave();
      return stats;
    } catch (err) {
      const classified = err instanceof TorrentError ? err : this._classifyError(err);
      this.emit('error', {
        infoHash: null,
        code: classified.code,
        message: classified.message,
      });
      throw classified;
    }
  }

  /**
   * @param {string} infoHash
   */
  async pauseTorrent(infoHash) {
    this._assertReady();
    const torrent = await this._getTorrentOrThrow(infoHash);
    const hash = this._normalizeHash(torrent.infoHash);
    this._stopped.delete(hash);
    this._applyPause(torrent);
    await this._emitStatsUpdate();
    this._scheduleSessionSave();
    return this._buildStats(torrent);
  }

  /**
   * @param {string} infoHash
   */
  async resumeTorrent(infoHash) {
    this._assertReady();
    const torrent = await this._getTorrentOrThrow(infoHash);
    const hash = this._normalizeHash(torrent.infoHash);
    this._stopped.delete(hash);
    this._applyResume(torrent);
    await this._emitStatsUpdate();
    this._scheduleSessionSave();
    return this._buildStats(torrent);
  }

  /**
   * Dừng hẳn — ngừng upload/seed nhưng vẫn giữ torrent trong danh sách.
   * @param {string} infoHash
   */
  async stopTorrent(infoHash) {
    this._assertReady();
    const torrent = await this._getTorrentOrThrow(infoHash);
    const hash = this._normalizeHash(torrent.infoHash);
    this._stopped.add(hash);
    this._applyPause(torrent);
    await this._emitStatsUpdate();
    this._scheduleSessionSave();
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
    const hash = this._normalizeHash(infoHash);

    const unavailable = this._unavailable.get(hash);
    if (unavailable) {
      this._unavailable.delete(hash);
      this.emit('removed', hash);
      this._scheduleSessionSave();
      await this._emitStatsUpdate();
      return { ok: true, infoHash: hash, deleteFiles: false };
    }

    const torrent = await this._getTorrentOrThrow(infoHash);
    const client = await getClient();

    const savedFiles = torrent.files.map((f) => f.path);
    const savedRoot = torrent.path;

    await new Promise((resolve, reject) => {
      client.remove(hash, { destroyStore: false }, (err) => {
        if (err) reject(this._classifyError(err));
        else resolve();
      });
    });

    this._active.delete(hash);
    this._fileTreeCache.delete(hash);
    this._stopped.delete(hash);
    this._torrentSources.delete(hash);

    if (deleteFiles) {
      await this._deleteFilesFromDisk(savedFiles, savedRoot);
    }

    this.emit('removed', hash);
    this._scheduleSessionSave();
    return { ok: true, infoHash: hash, deleteFiles };
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
    const byHash = new Map();

    for (const entry of this._unavailable.values()) {
      byHash.set(entry.infoHash, this._buildUnavailableStats(entry));
    }

    for (const hash of this._restoring) {
      const meta = this._restoringMeta.get(hash);
      if (meta) {
        byHash.set(hash, this._buildRestoringStats(meta));
      }
    }

    for (const torrent of client.torrents) {
      const stats = this._buildStats(torrent);
      byHash.set(stats.infoHash, stats);
    }

    return [...byHash.values()];
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

  async saveSessionNow() {
    if (this._sessionSaveTimer) {
      clearTimeout(this._sessionSaveTimer);
      this._sessionSaveTimer = null;
    }
    await this._persistSession();
  }

  destroy() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._sessionSaveTimer) {
      clearTimeout(this._sessionSaveTimer);
      this._sessionSaveTimer = null;
    }
    this._active.clear();
    this._fileTreeCache.clear();
    this._stopped.clear();
    this._torrentSources.clear();
    this._unavailable.clear();
    this._restoring.clear();
    this._restoringMeta.clear();
    destroyClient();
    this._ready = false;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  _assertReady() {
    if (!this._ready) {
      throw new TorrentError('NOT_INITIALIZED', 'TorrentManager chưa được khởi tạo — gọi init() trước');
    }
  }

  _normalizeHash(infoHash) {
    return String(infoHash).toLowerCase().trim();
  }

  async _getTorrentOrThrow(infoHash) {
    const client = await getClient();
    const normalized = this._normalizeHash(infoHash);

    let torrent = await client.get(normalized);
    if (!torrent) {
      torrent = client.torrents.find(
        (t) => this._normalizeHash(t.infoHash) === normalized
      );
    }
    if (!torrent) {
      throw new TorrentError('NOT_FOUND', `Không tìm thấy torrent: ${infoHash}`);
    }
    return torrent;
  }

  /**
   * WebTorrent pause() chỉ đặt cờ — peer hiện tại vẫn tải/lên.
   * @param {import('webtorrent').default.Torrent} torrent
   */
  _applyPause(torrent) {
    torrent.pause();
    this._disconnectAllPeers(torrent);
    this._pauseDiscovery(torrent);
  }

  /**
   * @param {import('webtorrent').default.Torrent} torrent
   */
  _applyResume(torrent) {
    torrent.resume();
    this._resumeDiscovery(torrent);
  }

  /**
   * @param {import('webtorrent').default.Torrent} torrent
   */
  _disconnectAllPeers(torrent) {
    for (const id of [...torrent._peers.keys()]) {
      torrent.removePeer(id);
    }
  }

  /**
   * @param {import('webtorrent').default.Torrent} torrent
   */
  _pauseDiscovery(torrent) {
    if (!torrent.discovery) return;
    const discovery = torrent.discovery;
    torrent.discovery = null;
    discovery.destroy(() => {});
  }

  /**
   * @param {import('webtorrent').default.Torrent} torrent
   */
  _resumeDiscovery(torrent) {
    if (torrent.discovery || torrent.destroyed || !torrent.ready) return;
    torrent._startDiscovery();
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
      this._scheduleSessionSave();
    });

    torrent.on('ready', () => {
      this._emitStatsUpdate().catch(() => {});
      this._scheduleSessionSave();
    });

    if (torrent.metadata) {
      this._onMetadataReady(torrent);
    }

    torrent.on('done', async () => {
      this._scheduleSessionSave();
      this.emit('update', await this.getTorrentStats());
    });

    torrent.on('download', () => {
      this._scheduleSessionSave();
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
    const hash = this._normalizeHash(torrent.infoHash);
    if (this._stopped.has(hash)) return 'stopped';
    if (torrent.paused) return 'paused';
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
      infoHash: this._normalizeHash(torrent.infoHash),
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
   * Xóa file của torrent trên đĩa — không xóa thư mục tải chung.
   * @param {string[]} relativePaths - đường dẫn tương đối trong torrent (file.path)
   * @param {string} downloadRoot - thư mục gốc tải về (torrent.path)
   */
  async _deleteFilesFromDisk(relativePaths, downloadRoot) {
    const errors = [];
    const root = path.resolve(downloadRoot);

    for (const relativePath of relativePaths) {
      const fullPath = path.resolve(root, relativePath);

      if (!this._isPathInsideRoot(fullPath, root)) {
        continue;
      }

      try {
        await fs.promises.rm(fullPath, { force: true });
      } catch (err) {
        if (err.code !== 'ENOENT') {
          errors.push({ filePath: fullPath, err });
        }
      }
    }

    // Dọn thư mục con rỗng do torrent tạo ra (không đụng thư mục gốc chung)
    const dirs = new Set();
    for (const relativePath of relativePaths) {
      let dir = path.dirname(path.resolve(root, relativePath));
      while (this._isPathInsideRoot(dir, root) && dir !== root) {
        dirs.add(dir);
        dir = path.dirname(dir);
      }
    }

    const sortedDirs = [...dirs].sort((a, b) => b.length - a.length);
    for (const dir of sortedDirs) {
      try {
        await fs.promises.rmdir(dir);
      } catch {
        // Thư mục không rỗng hoặc đã bị xóa — bỏ qua
      }
    }

    if (errors.length > 0) {
      const detail = errors.map(({ filePath, err }) => `${filePath}: ${err.message}`).join('; ');
      throw new TorrentError('DELETE_FAILED', `Không thể xóa một số file: ${detail}`, errors[0].err);
    }
  }

  /**
   * @param {string} targetPath
   * @param {string} rootPath
   */
  _isPathInsideRoot(targetPath, rootPath) {
    const relative = path.relative(rootPath, targetPath);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
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

  async _emitStatsUpdate() {
    const stats = await this.getTorrentStats();
    this.emit('update', stats);
  }

  _scheduleSessionSave() {
    if (this._sessionSaveTimer) clearTimeout(this._sessionSaveTimer);
    this._sessionSaveTimer = setTimeout(() => {
      this._sessionSaveTimer = null;
      this._persistSession().catch(() => {});
    }, SESSION_SAVE_DEBOUNCE_MS);
  }

  async _persistSession() {
    if (!this._ready) return;

    const client = await getClient();
    const activeEntries = client.torrents.map((torrent) => {
      const hash = this._normalizeHash(torrent.infoHash);
      return {
        torrentId: torrent.magnetURI || this._torrentSources.get(hash) || '',
        downloadPath: torrent.path,
        infoHash: hash,
        name: torrent.name || undefined,
        magnetURI: torrent.magnetURI || undefined,
        progress: Math.round(torrent.progress * 1000) / 10,
        length: torrent.length || 0,
        stopped: this._stopped.has(hash),
        paused: torrent.paused && !this._stopped.has(hash),
        unavailable: false,
      };
    });

    const unavailableEntries = [...this._unavailable.values()].map((entry) => ({
      torrentId: entry.torrentId || entry.magnetURI || '',
      downloadPath: entry.downloadPath || entry.path || getDefaultDownloadPath(),
      infoHash: entry.infoHash,
      name: entry.name,
      magnetURI: entry.magnetURI,
      progress: entry.progress || 0,
      length: entry.length || 0,
      stopped: false,
      paused: false,
      unavailable: true,
    }));

    await saveSession(
      [...activeEntries, ...unavailableEntries].filter((e) => e.torrentId || e.infoHash)
    );
  }

  async _restoreSession() {
    const entries = await loadSession();
    if (entries.length === 0) return;

    for (const entry of entries) {
      const hash = this._entryInfoHash(entry);
      if (!hash) continue;

      if (entry.unavailable) {
        this._unavailable.set(hash, {
          infoHash: hash,
          name: entry.name || this._guessName(entry) || 'Torrent không xác định',
          torrentId: entry.magnetURI || entry.torrentId,
          magnetURI: entry.magnetURI,
          downloadPath: entry.downloadPath,
          path: entry.downloadPath || '',
        });
      } else {
        this._restoring.add(hash);
        this._restoringMeta.set(hash, entry);
      }
    }

    await this._emitStatsUpdate();

    await Promise.allSettled(
      entries.filter((e) => !e.unavailable).map((entry) => this._restoreOneEntry(entry))
    );

    await this._emitStatsUpdate();
    this._scheduleSessionSave();
  }

  async _restoreOneEntry(entry) {
    const hash = this._entryInfoHash(entry);
    if (!hash) return;

    const torrentId = entry.magnetURI || entry.torrentId;
    if (!torrentId) {
      this._markUnavailable(entry, hash);
      return;
    }

    if (!torrentId.startsWith('magnet:?')) {
      try {
        await fs.promises.access(path.resolve(torrentId), fs.constants.R_OK);
      } catch {
        this._markUnavailable(entry, hash);
        return;
      }
    }

    try {
      const stats = await this._addTorrentWithOptions(
        torrentId,
        entry.downloadPath || getDefaultDownloadPath(),
        { paused: entry.stopped || entry.paused, restore: true, sessionEntry: entry }
      );

      const restoredHash = this._normalizeHash(stats.infoHash);
      this._restoring.delete(hash);
      this._restoring.delete(restoredHash);
      this._restoringMeta.delete(hash);
      this._restoringMeta.delete(restoredHash);
      this._unavailable.delete(hash);
      this._unavailable.delete(restoredHash);

      if (entry.stopped) {
        this._stopped.add(restoredHash);
      }

      await this._emitStatsUpdate();
    } catch (err) {
      console.error('[TorrentManager] Không khôi phục được torrent:', torrentId, err.message);

      if (entry.progress > 0 || entry.length > 0) {
        this._restoring.delete(hash);
        this._restoringMeta.delete(hash);
        this._unavailable.set(hash, {
          infoHash: hash,
          name: entry.name || this._guessName(entry) || 'Torrent không xác định',
          torrentId,
          magnetURI: entry.magnetURI,
          downloadPath: entry.downloadPath,
          path: entry.downloadPath || '',
          progress: entry.progress || 0,
          length: entry.length || 0,
        });
      } else {
        this._markUnavailable(entry, hash);
      }

      await this._emitStatsUpdate();
    }
  }

  _markUnavailable(entry, hash) {
    this._restoring.delete(hash);
    this._restoringMeta.delete(hash);
    this._unavailable.set(hash, {
      infoHash: hash,
      name: entry.name || this._guessName(entry) || 'Torrent không xác định',
      torrentId: entry.magnetURI || entry.torrentId,
      magnetURI: entry.magnetURI,
      downloadPath: entry.downloadPath,
      path: entry.downloadPath || '',
      progress: entry.progress || 0,
      length: entry.length || 0,
    });
  }

  _entryInfoHash(entry) {
    if (entry.infoHash) return this._normalizeHash(entry.infoHash);

    const id = entry.magnetURI || entry.torrentId || '';
    const magnetMatch = id.match(/xt=urn:btih:([a-fA-F0-9]{40})/i);
    if (magnetMatch) return magnetMatch[1].toLowerCase();

    const bareMatch = id.match(/^([a-fA-F0-9]{40})$/i);
    if (bareMatch) return bareMatch[1].toLowerCase();

    return null;
  }

  _guessName(entry) {
    if (entry.name) return entry.name;

    const id = entry.magnetURI || entry.torrentId || '';
    const dnMatch = id.match(/[?&]dn=([^&]+)/);
    if (dnMatch) {
      try {
        return decodeURIComponent(dnMatch[1].replace(/\+/g, ' '));
      } catch {
        return dnMatch[1];
      }
    }

    if (id && !id.startsWith('magnet:')) {
      return path.basename(id, '.torrent');
    }

    return null;
  }

  _buildRestoringStats(entry) {
    const hash = this._entryInfoHash(entry);
    return {
      infoHash: hash,
      name: entry.name || this._guessName(entry) || 'Đang khôi phục…',
      progress: entry.progress || 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      numPeers: 0,
      status: 'restoring',
      eta: null,
      length: entry.length || 0,
      path: entry.downloadPath || '',
    };
  }

  _buildUnavailableStats(entry) {
    return {
      infoHash: entry.infoHash,
      name: entry.name || 'Torrent không xác định',
      progress: entry.progress || 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      numPeers: 0,
      status: 'not_found',
      eta: null,
      length: entry.length || 0,
      path: entry.path || entry.downloadPath || '',
    };
  }

  /**
   * @param {string} torrentId
   * @param {string} [downloadPath]
   * @param {{ paused?: boolean, restore?: boolean, sessionEntry?: object }} [options]
   */
  async _addTorrentWithOptions(torrentId, downloadPath, options = {}) {
    this._assertReady();

    const trimmed = torrentId.trim();
    const targetPath = downloadPath || getDefaultDownloadPath();

    await this._ensureDownloadDir(targetPath);
    await this._assertDiskSpace(targetPath);

    const source = await this._resolveTorrentSource(trimmed);
    const client = await getClient();

    return new Promise((resolve, reject) => {
      let settled = false;
      let torrentRef = null;

      const succeed = (added) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        this._active.set(added.infoHash, added);
        this._torrentSources.set(this._normalizeHash(added.infoHash), trimmed);

        if (options.paused) {
          this._applyPause(added);
        }

        resolve(this._buildStats(added));
      };

      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        // Restore: không xóa file đã tải trên đĩa
        if (options.restore && torrentRef?.infoHash) {
          succeed(torrentRef);
          torrentRef.once('ready', () => {
            this._emitStatsUpdate().catch(() => {});
            this._scheduleSessionSave();
          });
          return;
        }

        if (torrentRef?.infoHash) {
          client.remove(torrentRef.infoHash, { destroyStore: false }, () => {});
          this._active.delete(torrentRef.infoHash);
        }

        reject(this._classifyError(err));
      };

      const timeoutMs = options.restore ? RESTORE_METADATA_TIMEOUT_MS : METADATA_TIMEOUT_MS;
      const timer = setTimeout(() => {
        if (options.restore && torrentRef?.infoHash) {
          succeed(torrentRef);
          torrentRef.once('ready', () => {
            this._emitStatsUpdate().catch(() => {});
            this._scheduleSessionSave();
          });
          return;
        }

        fail(new TorrentError(
          'METADATA_TIMEOUT',
          'Hết thời gian chờ metadata torrent (magnet link có thể không hợp lệ)'
        ));
      }, timeoutMs);

      try {
        torrentRef = client.add(
          source,
          { path: targetPath, paused: options.paused === true },
          (added) => {
            succeed(added);
          }
        );

        this._bindTorrentEvents(torrentRef);
        torrentRef.on('error', (err) => {
          if (options.restore) {
            console.error('[TorrentManager] restore warning:', err.message);
            return;
          }
          fail(err);
        });
      } catch (err) {
        fail(err);
      }
    });
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
