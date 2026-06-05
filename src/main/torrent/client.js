const path = require('path');
const { app } = require('electron');
const { CLIENT_OPTS } = require('./torrent-config');

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
    client = new WebTorrent(CLIENT_OPTS);
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
