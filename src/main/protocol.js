const path = require('path');
const { app } = require('electron');
const channels = require('./ipc/channels');

/** @type {Array<{ type: 'magnet'|'torrent', source: string }>} */
const pendingQueue = [];

/**
 * @param {() => import('electron').BrowserWindow | null} getMainWindow
 */
function createProtocolBridge(getMainWindow) {
  const sendPending = (payload) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      const send = () => win.webContents.send(channels.TORRENT_PENDING, payload);
      if (win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', send);
      } else {
        send();
      }
    } else {
      pendingQueue.push(payload);
    }
  };

  const flushQueue = () => {
    while (pendingQueue.length) {
      sendPending(pendingQueue.shift());
    }
  };

  const handleIncoming = (source) => {
    const payload = normalizeIncoming(source);
    if (payload) sendPending(payload);
  };

  return { handleIncoming, flushQueue, sendPending };
}

/**
 * @param {string} source
 * @returns {{ type: 'magnet'|'torrent', source: string } | null}
 */
function normalizeIncoming(source) {
  if (!source || typeof source !== 'string') return null;

  const trimmed = source.trim();
  if (trimmed.startsWith('magnet:?')) {
    return { type: 'magnet', source: trimmed };
  }

  if (trimmed.toLowerCase().endsWith('.torrent')) {
    return { type: 'torrent', source: path.resolve(trimmed) };
  }

  return null;
}

/**
 * Quét argv khi app khởi động (Windows / Linux).
 * @param {string[]} argv
 */
function parseArgvForTorrents(argv) {
  const results = [];
  for (const arg of argv) {
    const payload = normalizeIncoming(arg);
    if (payload) results.push(payload);
  }
  return results;
}

/**
 * open-url / open-file được xử lý tại index.js (buffer trước whenReady).
 * Đăng ký magnet:// handler: main.js → registerPackagedProtocolHandlers() (chỉ app.isPackaged).
 */
function setupProtocolListeners(_handleIncoming) {
  /* listeners ở index.js; đăng ký protocol ở main.js */
}

/**
 * @param {(source: string) => void} handleIncoming
 */
function setupSingleInstance(handleIncoming) {
  const gotLock = app.requestSingleInstanceLock();

  if (!gotLock) {
    app.quit();
    return false;
  }

  app.on('second-instance', (_event, argv) => {
    for (const payload of parseArgvForTorrents(argv)) {
      handleIncoming(payload.source);
    }
  });

  return true;
}

module.exports = {
  createProtocolBridge,
  normalizeIncoming,
  parseArgvForTorrents,
  setupProtocolListeners,
  setupSingleInstance,
};
