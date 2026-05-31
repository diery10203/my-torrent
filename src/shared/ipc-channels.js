/** Single source of truth for IPC channel names (main + preload) */
module.exports = {
  ADD_TORRENT: 'api:add-torrent',
  CONTROL_TORRENT: 'api:control-torrent',
  LIST_TORRENTS: 'api:list-torrents',
  GET_FILE_TREE: 'api:get-file-tree',
  TOGGLE_FILE: 'api:toggle-file',
  OPEN_TORRENT_FILE: 'api:open-torrent-file',
  SELECT_DOWNLOAD_DIR: 'api:select-download-dir',
  GET_DEFAULT_DOWNLOAD_DIR: 'api:get-default-download-dir',
  OPEN_TORRENT_FOLDER: 'api:open-torrent-folder',

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
  'api:control-torrent',
  'api:list-torrents',
  'api:get-file-tree',
  'api:toggle-file',
  'api:open-torrent-file',
  'api:select-download-dir',
  'api:get-default-download-dir',
  'api:open-torrent-folder',
];
