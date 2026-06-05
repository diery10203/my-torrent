const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const { createMainWindow, registerPackagedProtocolHandlers } = require('./main');
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
/** @type {((wc: import('electron').WebContents) => void) | null} */
let pushInitialState = null;
let isQuitting = false;
let startupComplete = false;

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

function ensureIpcHandlers() {
  const result = registerIpcHandlers(getMainWindow);
  if (result?.pushInitialState) {
    pushInitialState = result.pushInitialState;
  }
}

function wireWindowEvents(win) {
  win.webContents.on('did-finish-load', () => {
    pushInitialState?.(win.webContents);
    protocolBridge?.flushQueue();
  });
}

function openMainWindow() {
  if (!startupComplete) return null;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = createMainWindow();
  wireWindowEvents(mainWindow);
  return mainWindow;
}

function shutdownApp() {
  if (isQuitting) return;
  isQuitting = true;

  const forceExit = setTimeout(() => {
    torrentManager.destroy();
    app.exit(0);
  }, 2500);

  torrentManager
    .saveSessionNow()
    .catch(() => {})
    .finally(() => {
      clearTimeout(forceExit);
      torrentManager.destroy();
      app.exit(0);
    });
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

// macOS: click icon Dock — chỉ mở cửa sổ sau khi IPC + TorrentManager sẵn sàng
app.on('activate', () => {
  if (!startupComplete) return;

  if (BrowserWindow.getAllWindows().length === 0) {
    openMainWindow();
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    shutdownApp();
  }
});

app.on('before-quit', (e) => {
  if (isQuitting) return;
  e.preventDefault();
  shutdownApp();
});

if (!setupSingleInstance(handleExternalOpen)) {
  // Instance thứ hai — thoát ngay
} else {
  // Đăng ký IPC ngay khi main process load — trước whenReady / activate
  ensureIpcHandlers();

  protocolBridge = createProtocolBridge(getMainWindow);

  app.whenReady().then(async () => {
    if (process.platform === 'darwin' && app.dock) {
      const iconPath = path.join(__dirname, '../../assets/icon.png');
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon);
      } else {
        console.warn('[My Torrent] Không load được Dock icon:', iconPath);
      }
    }

    ensureIpcHandlers();

    await torrentManager.init();
    startupComplete = true;

    openMainWindow();

    setupProtocolListeners(handleExternalOpen);
    registerPackagedProtocolHandlers();

    for (const payload of parseArgvForTorrents(process.argv)) {
      handleExternalOpen(payload.source);
    }

    if (earlyOpenTarget) {
      handleExternalOpen(earlyOpenTarget);
      earlyOpenTarget = null;
    }

    torrentManager.restoreSession().catch((err) => {
      console.error('[My Torrent] Khôi phục session thất bại:', err.message);
    });
  });
}
