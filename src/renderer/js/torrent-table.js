class TorrentTable {
  constructor(tbodyId, emptyStateId) {
    this.tbody = document.getElementById(tbodyId);
    this.emptyState = document.getElementById(emptyStateId);
    this.torrents = [];
    this.selectedHash = null;
    this.filter = '';
  }

  setTorrents(torrents) {
    this.torrents = torrents;
    this.render();
  }

  setFilter(query) {
    this.filter = query.toLowerCase();
    this.render();
  }

  getSelected() {
    return this.selectedHash;
  }

  select(infoHash) {
    this.selectedHash = infoHash;
    this.render();
  }

  _filtered() {
    if (!this.filter) return this.torrents;
    return this.torrents.filter((t) =>
      t.name.toLowerCase().includes(this.filter)
    );
  }

  render() {
    const rows = this._filtered();

    if (rows.length === 0) {
      this.tbody.innerHTML = '';
      this.emptyState.classList.remove('hidden');
      return;
    }

    this.emptyState.classList.add('hidden');

    this.tbody.innerHTML = rows.map((t) => {
      const status = getStatus(t);
      const pct = formatProgress(t.progress);
      const selected = t.infoHash === this.selectedHash ? 'selected' : '';

      return `
        <tr data-hash="${t.infoHash}" class="${selected}">
          <td title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</td>
          <td>${formatBytes(t.length)}</td>
          <td>
            <div class="progress-bar">
              <div class="progress-fill" style="width:${t.progress * 100}%"></div>
              <span class="progress-label">${pct}</span>
            </div>
          </td>
          <td><span class="badge ${status.cls}">${status.label}</span></td>
          <td>${formatSpeed(t.downloadSpeed)}</td>
          <td>${formatSpeed(t.uploadSpeed)}</td>
          <td>${t.numPeers}</td>
          <td>${t.done ? '—' : formatETA(t.timeRemaining)}</td>
        </tr>
      `;
    }).join('');

    this.tbody.querySelectorAll('tr').forEach((row) => {
      row.addEventListener('click', () => {
        this.select(row.dataset.hash);
      });
    });
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
