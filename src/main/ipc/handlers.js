const { ipcMain, dialog } = require('electron');
const channels = require('./channels');
const { torrentManager } = require('../torrent/manager');

function registerIpcHandlers(getMainWindow) {
  ipcMain.handle(channels.TORRENT_LIST, () => {
    return torrentManager.list();
  });

  ipcMain.handle(channels.TORRENT_ADD, async (_event, { magnetURI, torrentPath, downloadDir }) => {
    return torrentManager.add({ magnetURI, torrentPath, downloadDir });
  });

  ipcMain.handle(channels.TORRENT_REMOVE, async (_event, infoHash) => {
    await torrentManager.remove(infoHash);
    return { ok: true };
  });

  ipcMain.handle(channels.TORRENT_PAUSE, async (_event, infoHash) => {
    await torrentManager.pause(infoHash);
    return { ok: true };
  });

  ipcMain.handle(channels.TORRENT_RESUME, async (_event, infoHash) => {
    await torrentManager.resume(infoHash);
    return { ok: true };
  });

  ipcMain.handle(channels.TORRENT_SELECT_DOWNLOAD_DIR, async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Chọn thư mục tải về',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  torrentManager.on('update', (torrents) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channels.TORRENT_UPDATE, torrents);
    }
  });

  torrentManager.on('added', (torrent) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channels.TORRENT_ADDED, torrent);
    }
  });

  torrentManager.on('removed', (infoHash) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channels.TORRENT_REMOVED, infoHash);
    }
  });

  torrentManager.on('error', (payload) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channels.TORRENT_ERROR, payload);
    }
  });
}

module.exports = { registerIpcHandlers };
