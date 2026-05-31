const { app, BrowserWindow } = require('electron');
const { createMainWindow } = require('./window');
const { registerIpcHandlers } = require('./ipc/handlers');
const { torrentManager } = require('./torrent/TorrentManager');
const {
  createProtocolBridge,
  parseArgvForTorrents,
  setupProtocolListeners,
  setupSingleInstance,
} = require('./protocol');

let mainWindow = null;
/** @type {ReturnType<typeof createProtocolBridge> | null} */
let protocolBridge = null;
let sessionSavedOnQuit = false;

/** URL/file mở trước khi app ready (macOS) */
/** @type {string | null} */
let earlyOpenTarget = null;

function getMainWindow() {
  return mainWindow;
}

function handleExternalOpen(source) {
  if (protocolBridge) {
    protocolBridge.handleIncoming(source);
  }
}

// Buffer open-url / open-file trước whenReady (macOS)
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (app.isReady()) handleExternalOpen(url);
  else earlyOpenTarget = url;
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) handleExternalOpen(filePath);
  else earlyOpenTarget = filePath;
});

if (!setupSingleInstance(handleExternalOpen)) {
  // Instance thứ hai — thoát
} else {
  protocolBridge = createProtocolBridge(getMainWindow);

  app.whenReady().then(async () => {
    const { pushInitialState } = registerIpcHandlers(getMainWindow);

    await torrentManager.init();

    mainWindow = createMainWindow();

    mainWindow.webContents.on('did-finish-load', () => {
      pushInitialState(mainWindow.webContents);
      protocolBridge.flushQueue();
    });

    setupProtocolListeners(handleExternalOpen);

    for (const payload of parseArgvForTorrents(process.argv)) {
      handleExternalOpen(payload.source);
    }

    if (earlyOpenTarget) {
      handleExternalOpen(earlyOpenTarget);
      earlyOpenTarget = null;
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (e) => {
  if (sessionSavedOnQuit) {
    torrentManager.destroy();
    return;
  }

  e.preventDefault();
  torrentManager.saveSessionNow().finally(() => {
    sessionSavedOnQuit = true;
    app.quit();
  });
});
