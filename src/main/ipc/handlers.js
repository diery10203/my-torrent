const { ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const channels = require('./channels');
const { torrentManager } = require('../torrent/TorrentManager');
const { getDefaultDownloadPath } = require('../torrent/client');

/**
 * Register IPC handlers that bridge renderer ↔ TorrentManager.
 * Uses ipcMain.handle for request/response (renderer invoke).
 * Push events are sent via webContents.send (see _bindTorrentEvents).
 *
 * @param {() => import('electron').BrowserWindow | null} getMainWindow
 */
function registerIpcHandlers(getMainWindow) {
  for (const ch of channels.INVOKE) {
    ipcMain.removeHandler(ch);
  }

  // ── Renderer → Main ────────────────────────────────────────────────────────

  ipcMain.handle(channels.ADD_TORRENT, async (_event, id, downloadPath, options = {}) => {
    if (!id || typeof id !== 'string') {
      throw new Error('id phải là chuỗi magnet URI hoặc đường dẫn .torrent');
    }
    return torrentManager.addTorrent(id.trim(), downloadPath, options);
  });

  ipcMain.handle(channels.INSPECT_TORRENT_SOURCE, async (_event, source) => {
    if (!source || typeof source !== 'string') {
      throw new Error('source phải là magnet URI hoặc đường dẫn .torrent');
    }
    return torrentManager.inspectTorrentSource(source.trim());
  });

  ipcMain.handle(channels.PREPARE_TORRENT_PREVIEW, async (_event, source, downloadPath) => {
    if (!source || typeof source !== 'string') {
      throw new Error('source phải là magnet URI hoặc đường dẫn .torrent');
    }
    if (!downloadPath || typeof downloadPath !== 'string') {
      throw new Error('downloadPath phải là thư mục hợp lệ');
    }
    return torrentManager.prepareTorrentPreview(source.trim(), downloadPath);
  });

  ipcMain.handle(channels.CONFIRM_TORRENT_PREVIEW, async (_event, infoHash, fileSelection) => {
    if (!infoHash || typeof infoHash !== 'string') {
      throw new Error('infoHash không hợp lệ');
    }
    if (!Array.isArray(fileSelection)) {
      throw new Error('fileSelection phải là mảng boolean');
    }
    return torrentManager.confirmTorrentPreview(infoHash, fileSelection);
  });

  ipcMain.handle(channels.CANCEL_TORRENT_PREVIEW, async (_event, infoHash) => {
    if (!infoHash || typeof infoHash !== 'string') {
      throw new Error('infoHash không hợp lệ');
    }
    return torrentManager.cancelTorrentPreview(infoHash);
  });

  ipcMain.handle(channels.CONTROL_TORRENT, async (_event, infoHash, action, options = {}) => {
    switch (action) {
      case 'pause':
        return torrentManager.pauseTorrent(infoHash);
      case 'resume':
        return torrentManager.resumeTorrent(infoHash);
      case 'stop':
        return torrentManager.stopTorrent(infoHash);
      case 'delete':
        return torrentManager.removeTorrent(infoHash, options.deleteFiles === true);
      default:
        throw new Error(`action không hợp lệ: ${action} — dùng pause | resume | stop | delete`);
    }
  });

  ipcMain.handle(channels.LIST_TORRENTS, () => {
    return torrentManager.getTorrentStats();
  });

  ipcMain.handle(channels.GET_FILE_TREE, async (_event, infoHash) => {
    return torrentManager.getFileTree(infoHash);
  });

  ipcMain.handle(channels.TOGGLE_FILE, (_event, infoHash, fileIndex, shouldDownload) => {
    return torrentManager.toggleFileSelection(infoHash, fileIndex, shouldDownload);
  });

  ipcMain.handle(channels.OPEN_TORRENT_FILE, async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'BitTorrent', extensions: ['torrent'] }],
      title: 'Chọn file .torrent',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(channels.SELECT_DOWNLOAD_DIR, async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Chọn thư mục tải về',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(channels.GET_DEFAULT_DOWNLOAD_DIR, () => {
    return getDefaultDownloadPath();
  });

  ipcMain.handle(channels.WINDOW_MINIMIZE, () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.minimize();
    return { ok: true };
  });

  ipcMain.handle(channels.WINDOW_MAXIMIZE_TOGGLE, () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { maximized: false };

    if (win.isMaximized()) {
      win.unmaximize();
      return { maximized: false };
    }

    win.maximize();
    return { maximized: true };
  });

  ipcMain.handle(channels.WINDOW_IS_MAXIMIZED, () => {
    const win = getMainWindow();
    return { maximized: Boolean(win && !win.isDestroyed() && win.isMaximized()) };
  });

  ipcMain.handle(channels.WINDOW_CLOSE, () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.close();
    return { ok: true };
  });

  ipcMain.handle(channels.OPEN_TORRENT_FOLDER, async (_event, infoHash) => {
    const stats = await torrentManager.getTorrentStats();
    const torrent = stats.find((t) => t.infoHash === infoHash);

    if (!torrent) {
      throw new Error('Không tìm thấy torrent');
    }

    if (!torrent.path) {
      throw new Error('Torrent chưa có thư mục lưu — đợi metadata tải xong');
    }

    try {
      await fs.promises.access(torrent.path, fs.constants.F_OK);
    } catch {
      throw new Error(`Thư mục chưa tồn tại: ${torrent.path}`);
    }

    const errMsg = await shell.openPath(torrent.path);
    if (errMsg) {
      throw new Error(errMsg);
    }

    return { ok: true, path: torrent.path };
  });

  // ── Main → Renderer (TorrentManager events) ────────────────────────────────

  return _bindTorrentEvents(getMainWindow);
}

/**
 * Forward TorrentManager events to the renderer via webContents.send.
 * @param {() => import('electron').BrowserWindow | null} getMainWindow
 */
let _eventsBound = false;

function _bindTorrentEvents(getMainWindow) {
  const pushInitialState = async (webContents) => {
    if (webContents.isDestroyed()) return;
    try {
      const stats = await torrentManager.getTorrentStats();
      webContents.send(channels.TORRENT_UPDATE, stats);
    } catch { /* ignore */ }
  };

  if (_eventsBound) {
    return { pushInitialState };
  }
  _eventsBound = true;

  const send = (channel, payload) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };

  torrentManager.on('update', (torrents) => {
    send(channels.TORRENT_UPDATE, torrents);
  });

  torrentManager.on('metadata', (payload) => {
    send(channels.METADATA_READY, payload);
  });

  torrentManager.on('removed', (infoHash) => {
    send(channels.TORRENT_REMOVED, infoHash);
  });

  torrentManager.on('error', (payload) => {
    send(channels.TORRENT_ERROR, payload);
  });

  torrentManager.on('file-selection-changed', (payload) => {
    send(channels.FILE_SELECTION, payload);
  });

  return { pushInitialState };
}

module.exports = { registerIpcHandlers };
