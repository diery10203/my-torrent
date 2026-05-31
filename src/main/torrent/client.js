const path = require('path');
const { app } = require('electron');

let client = null;
let WebTorrentClass = null;

async function loadWebTorrent() {
  if (!WebTorrentClass) {
    const mod = await import('webtorrent');
    WebTorrentClass = mod.default;
  }
  return WebTorrentClass;
}

function getDefaultDownloadPath() {
  return path.join(app.getPath('downloads'), 'MyTorrent');
}

async function getClient() {
  if (!client) {
    const WebTorrent = await loadWebTorrent();
    client = new WebTorrent();
  }
  return client;
}

function destroyClient() {
  if (client) {
    client.destroy();
    client = null;
  }
}

module.exports = {
  getClient,
  destroyClient,
  getDefaultDownloadPath,
};
