const { app, BrowserWindow } = require('electron');
const { createMainWindow } = require('./window');
const { registerIpcHandlers } = require('./ipc/handlers');
const { torrentManager } = require('./torrent/manager');

let mainWindow = null;

function getMainWindow() {
  return mainWindow;
}

app.whenReady().then(async () => {
  registerIpcHandlers(getMainWindow);
  await torrentManager.init();

  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  torrentManager.destroy();
});
