/** IPC channel names — shared contract between main and preload */
module.exports = {
  // Torrent actions (renderer → main)
  TORRENT_ADD: 'torrent:add',
  TORRENT_REMOVE: 'torrent:remove',
  TORRENT_PAUSE: 'torrent:pause',
  TORRENT_RESUME: 'torrent:resume',
  TORRENT_LIST: 'torrent:list',
  TORRENT_SELECT_DOWNLOAD_DIR: 'torrent:select-download-dir',

  // Torrent events (main → renderer)
  TORRENT_UPDATE: 'torrent:update',
  TORRENT_ADDED: 'torrent:added',
  TORRENT_REMOVED: 'torrent:removed',
  TORRENT_ERROR: 'torrent:error',
};
