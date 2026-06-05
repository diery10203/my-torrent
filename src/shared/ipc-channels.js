/** Single source of truth for IPC channel names (main + preload) */
module.exports = {
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

/** Channels renderer is allowed to receive via ipcRenderer.on */
module.exports.INCOMING = [
  'api:torrent-update',
  'api:metadata-ready',
  'api:torrent-removed',
  'api:torrent-error',
  'api:file-selection',
  'api:torrent-pending',
];

/** Channels renderer is allowed to invoke via ipcRenderer.invoke */
module.exports.INVOKE = [
  'api:add-torrent',
  'api:inspect-torrent-source',
  'api:prepare-torrent-preview',
  'api:confirm-torrent-preview',
  'api:cancel-torrent-preview',
  'api:control-torrent',
  'api:list-torrents',
  'api:get-file-tree',
  'api:toggle-file',
  'api:open-torrent-file',
  'api:select-download-dir',
  'api:get-default-download-dir',
  'api:open-torrent-folder',
  'api:window-minimize',
  'api:window-maximize-toggle',
  'api:window-close',
  'api:window-is-maximized',
];
