const table = new TorrentTable('torrent-tbody', 'empty-state');
let downloadDir = null;

async function init() {
  const torrents = await window.electronAPI.torrent.list();
  table.setTorrents(torrents);
  updateStatusBar(torrents);

  window.electronAPI.torrent.onUpdate((updated) => {
    table.setTorrents(updated);
    updateStatusBar(updated);
    document.getElementById('status-label').textContent =
      `${updated.length} torrent${updated.length !== 1 ? 's' : ''}`;
  });

  window.electronAPI.torrent.onError(({ message }) => {
    console.error('Torrent error:', message);
  });

  bindToolbar();
}

function updateStatusBar(torrents) {
  const totalDown = torrents.reduce((s, t) => s + t.downloadSpeed, 0);
  const totalUp = torrents.reduce((s, t) => s + t.uploadSpeed, 0);
  const totalPeers = torrents.reduce((s, t) => s + t.numPeers, 0);

  document.getElementById('global-down').textContent = `↓ ${formatSpeed(totalDown)}`;
  document.getElementById('global-up').textContent = `↑ ${formatSpeed(totalUp)}`;
  document.getElementById('global-peers').textContent = `Peers: ${totalPeers}`;
}

function bindToolbar() {
  const magnetDialog = document.getElementById('magnet-dialog');
  const magnetInput = document.getElementById('magnet-input');

  document.getElementById('btn-add-magnet').addEventListener('click', () => {
    magnetInput.value = '';
    magnetDialog.showModal();
  });

  document.getElementById('magnet-cancel').addEventListener('click', () => {
    magnetDialog.close();
  });

  magnetDialog.addEventListener('close', async () => {
    const uri = magnetInput.value.trim();
    if (!uri) return;
    try {
      await window.electronAPI.torrent.add({
        magnetURI: uri,
        downloadDir,
      });
    } catch (err) {
      console.error('Failed to add magnet:', err);
    }
  });

  document.getElementById('btn-pause').addEventListener('click', async () => {
    const hash = table.getSelected();
    if (hash) await window.electronAPI.torrent.pause(hash);
  });

  document.getElementById('btn-resume').addEventListener('click', async () => {
    const hash = table.getSelected();
    if (hash) await window.electronAPI.torrent.resume(hash);
  });

  document.getElementById('btn-remove').addEventListener('click', async () => {
    const hash = table.getSelected();
    if (hash) await window.electronAPI.torrent.remove(hash);
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    table.setFilter(e.target.value);
  });
}

document.addEventListener('DOMContentLoaded', init);
