/**
 * Preload script — phải self-contained khi sandbox: true.
 * Không dùng require('path') hay require file ngoài (sandbox chặn Node builtins).
 * Giữ đồng bộ với src/shared/ipc-channels.js
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CH = {
  ADD_TORRENT: 'api:add-torrent',
  INSPECT_TORRENT_SOURCE: 'api:inspect-torrent-source',
  PREPARE_TORRENT_PREVIEW: 'api:prepare-torrent-preview',
  CONFIRM_TORRENT_PREVIEW: 'api:confirm-torrent-preview',
  CANCEL_TORRENT_PREVIEW: 'api:cancel-torrent-preview',
  CONTROL_TORRENT: 'api:control-torrent',
  LIST_TORRENTS: 'api:list-torrents',
  GET_FILE_TREE: 'api:get-file-tree',
  TOGGLE_FILE: 'api:toggle-file',
  OPEN_TORRENT_FILE: 'api:open-torrent-file',
  SELECT_DOWNLOAD_DIR: 'api:select-download-dir',
  GET_DEFAULT_DOWNLOAD_DIR: 'api:get-default-download-dir',
  OPEN_TORRENT_FOLDER: 'api:open-torrent-folder',
  WINDOW_MINIMIZE: 'api:window-minimize',
  WINDOW_MAXIMIZE_TOGGLE: 'api:window-maximize-toggle',
  WINDOW_CLOSE: 'api:window-close',
  WINDOW_IS_MAXIMIZED: 'api:window-is-maximized',
  TORRENT_UPDATE: 'api:torrent-update',
  METADATA_READY: 'api:metadata-ready',
  TORRENT_REMOVED: 'api:torrent-removed',
  TORRENT_ERROR: 'api:torrent-error',
  FILE_SELECTION: 'api:file-selection',
  TORRENT_PENDING: 'api:torrent-pending',
};

const INVOKE = new Set([
  CH.ADD_TORRENT,
  CH.INSPECT_TORRENT_SOURCE,
  CH.PREPARE_TORRENT_PREVIEW,
  CH.CONFIRM_TORRENT_PREVIEW,
  CH.CANCEL_TORRENT_PREVIEW,
  CH.CONTROL_TORRENT,
  CH.LIST_TORRENTS,
  CH.GET_FILE_TREE,
  CH.TOGGLE_FILE,
  CH.OPEN_TORRENT_FILE,
  CH.SELECT_DOWNLOAD_DIR,
  CH.GET_DEFAULT_DOWNLOAD_DIR,
  CH.OPEN_TORRENT_FOLDER,
  CH.WINDOW_MINIMIZE,
  CH.WINDOW_MAXIMIZE_TOGGLE,
  CH.WINDOW_CLOSE,
  CH.WINDOW_IS_MAXIMIZED,
]);

const INCOMING = new Set([
  CH.TORRENT_UPDATE,
  CH.METADATA_READY,
  CH.TORRENT_REMOVED,
  CH.TORRENT_ERROR,
  CH.FILE_SELECTION,
  CH.TORRENT_PENDING,
]);

function invoke(channel, ...args) {
  if (!INVOKE.has(channel)) throw new Error(`IPC invoke bị chặn: ${channel}`);
  return ipcRenderer.invoke(channel, ...args);
}

function subscribe(channel, callback) {
  if (!INCOMING.has(channel)) throw new Error(`IPC listen bị chặn: ${channel}`);
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  addTorrent: (id, downloadPath, options = {}) =>
    invoke(CH.ADD_TORRENT, id, downloadPath, options),

  inspectTorrentSource: (source) => invoke(CH.INSPECT_TORRENT_SOURCE, source),

  prepareTorrentPreview: (source, downloadPath) =>
    invoke(CH.PREPARE_TORRENT_PREVIEW, source, downloadPath),

  confirmTorrentPreview: (infoHash, fileSelection) =>
    invoke(CH.CONFIRM_TORRENT_PREVIEW, infoHash, fileSelection),

  cancelTorrentPreview: (infoHash) => invoke(CH.CANCEL_TORRENT_PREVIEW, infoHash),

  controlTorrent: (infoHash, action, options = {}) =>
    invoke(CH.CONTROL_TORRENT, infoHash, action, options),

  listTorrents: () => invoke(CH.LIST_TORRENTS),

  getFileTree: (infoHash) => invoke(CH.GET_FILE_TREE, infoHash),

  toggleFileSelection: (infoHash, fileIndex, shouldDownload) =>
    invoke(CH.TOGGLE_FILE, infoHash, fileIndex, shouldDownload),

  openTorrentFile: () => invoke(CH.OPEN_TORRENT_FILE),

  selectDownloadDir: () => invoke(CH.SELECT_DOWNLOAD_DIR),

  getDefaultDownloadDir: () => invoke(CH.GET_DEFAULT_DOWNLOAD_DIR),

  openTorrentFolder: (infoHash) => invoke(CH.OPEN_TORRENT_FOLDER, infoHash),

  platform: process.platform,

  windowControls: {
    minimize: () => invoke(CH.WINDOW_MINIMIZE),
    maximizeToggle: () => invoke(CH.WINDOW_MAXIMIZE_TOGGLE),
    close: () => invoke(CH.WINDOW_CLOSE),
    isMaximized: () => invoke(CH.WINDOW_IS_MAXIMIZED),
  },

  /** Đường dẫn tuyệt đối của file khi kéo-thả vào renderer (sandbox) */
  getPathForFile: (file) => webUtils.getPathForFile(file),

  onTorrentUpdate: (cb) => subscribe(CH.TORRENT_UPDATE, cb),

  onMetadataReady: (cb) => subscribe(CH.METADATA_READY, cb),

  onTorrentRemoved: (cb) => subscribe(CH.TORRENT_REMOVED, cb),

  onError: (cb) => subscribe(CH.TORRENT_ERROR, cb),

  onFileSelectionChanged: (cb) => subscribe(CH.FILE_SELECTION, cb),

  onTorrentPending: (cb) => subscribe(CH.TORRENT_PENDING, cb),
});
