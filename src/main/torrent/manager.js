const fs = require('fs');
const { EventEmitter } = require('events');
const { getClient, destroyClient, getDefaultDownloadPath } = require('./client');

class TorrentManager extends EventEmitter {
  constructor() {
    super();
    this._torrents = new Map();
    this._updateInterval = null;
  }

  async init() {
    const downloadPath = getDefaultDownloadPath();
    await fs.promises.mkdir(downloadPath, { recursive: true });
    await getClient();
    this._startPolling();
  }

  _startPolling() {
    this._updateInterval = setInterval(async () => {
      this.emit('update', await this.list());
    }, 1000);
  }

  _serialize(torrent) {
    return {
      infoHash: torrent.infoHash,
      name: torrent.name || 'Đang tải metadata…',
      progress: torrent.progress,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      downloaded: torrent.downloaded,
      uploaded: torrent.uploaded,
      length: torrent.length,
      numPeers: torrent.numPeers,
      timeRemaining: torrent.timeRemaining,
      done: torrent.done,
      paused: torrent.paused,
      path: torrent.path,
    };
  }

  async list() {
    const client = await getClient();
    return client.torrents.map((t) => this._serialize(t));
  }

  async add({ magnetURI, torrentPath, downloadDir }) {
    const client = await getClient();
    const opts = {
      path: downloadDir || getDefaultDownloadPath(),
    };

    const source = magnetURI || torrentPath;
    if (!source) {
      throw new Error('Cần magnet URI hoặc đường dẫn file .torrent');
    }

    return new Promise((resolve, reject) => {
      const torrent = client.add(source, opts, (added) => {
        this._torrents.set(added.infoHash, added);
        const serialized = this._serialize(added);
        this.emit('added', serialized);
        resolve(serialized);
      });

      torrent.on('error', (err) => {
        this.emit('error', { infoHash: torrent.infoHash, message: err.message });
        reject(err);
      });
    });
  }

  async remove(infoHash) {
    const client = await getClient();
    const torrent = client.get(infoHash);
    if (torrent) {
      client.remove(infoHash);
      this._torrents.delete(infoHash);
      this.emit('removed', infoHash);
    }
  }

  async pause(infoHash) {
    const client = await getClient();
    const torrent = client.get(infoHash);
    if (torrent) {
      torrent.pause();
    }
  }

  async resume(infoHash) {
    const client = await getClient();
    const torrent = client.get(infoHash);
    if (torrent) {
      torrent.resume();
    }
  }

  destroy() {
    if (this._updateInterval) {
      clearInterval(this._updateInterval);
      this._updateInterval = null;
    }
    destroyClient();
  }
}

const torrentManager = new TorrentManager();

module.exports = { torrentManager };
