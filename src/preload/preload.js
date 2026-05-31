const { contextBridge, ipcRenderer } = require('electron');

const channels = {
  TORRENT_ADD: 'torrent:add',
  TORRENT_REMOVE: 'torrent:remove',
  TORRENT_PAUSE: 'torrent:pause',
  TORRENT_RESUME: 'torrent:resume',
  TORRENT_LIST: 'torrent:list',
  TORRENT_SELECT_DOWNLOAD_DIR: 'torrent:select-download-dir',
  TORRENT_UPDATE: 'torrent:update',
  TORRENT_ADDED: 'torrent:added',
  TORRENT_REMOVED: 'torrent:removed',
  TORRENT_ERROR: 'torrent:error',
};

/** @type {import('./preload.d.ts').ElectronAPI} */
const api = {
  torrent: {
    list: () => ipcRenderer.invoke(channels.TORRENT_LIST),
    add: (options) => ipcRenderer.invoke(channels.TORRENT_ADD, options),
    remove: (infoHash) => ipcRenderer.invoke(channels.TORRENT_REMOVE, infoHash),
    pause: (infoHash) => ipcRenderer.invoke(channels.TORRENT_PAUSE, infoHash),
    resume: (infoHash) => ipcRenderer.invoke(channels.TORRENT_RESUME, infoHash),
    selectDownloadDir: () => ipcRenderer.invoke(channels.TORRENT_SELECT_DOWNLOAD_DIR),

    onUpdate: (callback) => {
      const listener = (_event, torrents) => callback(torrents);
      ipcRenderer.on(channels.TORRENT_UPDATE, listener);
      return () => ipcRenderer.removeListener(channels.TORRENT_UPDATE, listener);
    },

    onAdded: (callback) => {
      const listener = (_event, torrent) => callback(torrent);
      ipcRenderer.on(channels.TORRENT_ADDED, listener);
      return () => ipcRenderer.removeListener(channels.TORRENT_ADDED, listener);
    },

    onRemoved: (callback) => {
      const listener = (_event, infoHash) => callback(infoHash);
      ipcRenderer.on(channels.TORRENT_REMOVED, listener);
      return () => ipcRenderer.removeListener(channels.TORRENT_REMOVED, listener);
    },

    onError: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on(channels.TORRENT_ERROR, listener);
      return () => ipcRenderer.removeListener(channels.TORRENT_ERROR, listener);
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
