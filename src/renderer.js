/**
 * Renderer — Liquid Glass UI (src/index.html)
 * IPC qua window.api (preload). Cập nhật bảng torrent theo infoHash, không re-render cả bảng.
 */

/* ── Formatters ───────────────────────────────────────────────────────────── */
function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const val = n / 1024 ** i;
  return `${val < 10 && i > 0 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

function formatSpeed(bps) {
  const n = Number(bps) || 0;
  if (n <= 0) return '—';
  return `${formatBytes(n)}/s`;
}

function formatProgressPercent(progress) {
  const p = Math.max(0, Math.min(100, Number(progress) || 0));
  if (p >= 100) return '100%';
  const rounded = Math.round(p * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function formatProgressLabel(progress, status) {
  if (status === 'paused' || status === 'stopped') return 'Paused';
  return formatProgressPercent(progress);
}

function formatSpeedCell(torrent) {
  const down = torrent.downloadSpeed || 0;
  const up = torrent.uploadSpeed || 0;
  const parts = [];
  if (down > 0) parts.push(`↓ ${formatSpeed(down)}`);
  if (up > 0) parts.push(`↑ ${formatSpeed(up)}`);
  return parts.length ? parts.join(' · ') : '—';
}

/* ── Torrent table (DOM diff by infoHash) ─────────────────────────────────── */
/** @type {Map<string, { tr: HTMLTableRowElement, fill: HTMLElement, pct: HTMLElement, speed: HTMLElement, size: HTMLElement, name: HTMLElement }>} */
const rowByHash = new Map();

let selectedHash = null;
let activeFilter = 'all';
/** @type {Array<object>} */
let lastTorrentList = [];

const tbody = () => document.getElementById('torrent-tbody');
const statusDown = () => document.querySelector('.status-item:nth-child(1)');
const statusUp = () => document.querySelector('.status-item:nth-child(2)');
const statusSummary = () => document.querySelector('.status-item--dim');

/**
 * @param {object} torrent
 * @returns {HTMLTableRowElement}
 */
function createTorrentRow(torrent) {
  const tr = document.createElement('tr');
  tr.className = 'torrent-row';
  tr.title = 'Nhấp đúp để mở thư mục';
  tr.dataset.infoHash = torrent.infoHash;
  tr.dataset.status = torrent.status || 'downloading';

  const tdName = document.createElement('td');
  tdName.className = 'col-name';
  const nameEl = document.createElement('span');
  nameEl.className = 'torrent-name';
  nameEl.textContent = torrent.name || 'Torrent';
  nameEl.title = torrent.name || '';
  tdName.appendChild(nameEl);

  const tdSize = document.createElement('td');
  tdSize.className = 'col-size';

  const tdProgress = document.createElement('td');
  tdProgress.className = 'col-progress';

  const track = document.createElement('div');
  track.className = 'progress-track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');

  const fill = document.createElement('div');
  fill.className = 'progress-fill';
  track.appendChild(fill);

  const pct = document.createElement('span');
  pct.className = 'progress-pct';

  tdProgress.append(track, pct);

  const tdSpeed = document.createElement('td');
  tdSpeed.className = 'col-speed';

  tr.append(tdName, tdSize, tdProgress, tdSpeed);

  tr.addEventListener('click', () => selectRow(torrent.infoHash));
  tr.addEventListener('dblclick', () => {
    void openTorrentFolder(torrent.infoHash);
  });
  tr.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    selectRow(torrent.infoHash);
    showTorrentContextMenu(e.clientX, e.clientY, torrent.infoHash);
  });

  return tr;
}

/**
 * @param {string} infoHash
 */
async function openTorrentFolder(infoHash) {
  if (!window.api?.openTorrentFolder || !infoHash) return;
  try {
    await window.api.openTorrentFolder(infoHash);
  } catch (err) {
    alert(err?.message || 'Không mở được thư mục torrent');
  }
}

/** @type {HTMLElement | null} */
let contextMenuEl = null;
let contextMenuOpen = false;

function getTorrentByHash(infoHash) {
  return lastTorrentList.find((t) => t.infoHash === infoHash);
}

function hideTorrentContextMenu() {
  if (!contextMenuEl) return;
  contextMenuEl.classList.add('hidden');
  contextMenuEl.setAttribute('aria-hidden', 'true');
  contextMenuEl.replaceChildren();
  contextMenuOpen = false;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {string} infoHash
 */
function showTorrentContextMenu(x, y, infoHash) {
  const menu = contextMenuEl;
  if (!menu || !infoHash) return;

  const torrent = getTorrentByHash(infoHash);
  const status = torrent?.status || rowByHash.get(infoHash)?.tr.dataset.status || 'downloading';
  const isPaused = status === 'paused' || status === 'stopped';

  hideTorrentContextMenu();

  /** @param {string} label
   *  @param {() => void} onClick
   *  @param {{ danger?: boolean, disabled?: boolean }} [opts]
   */
  const addItem = (label, onClick, opts = {}) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'context-menu-item';
    if (opts.danger) btn.classList.add('context-menu-item--danger');
    btn.setAttribute('role', 'menuitem');
    btn.textContent = label;
    btn.disabled = !!opts.disabled;
    btn.addEventListener('click', () => {
      hideTorrentContextMenu();
      onClick();
    });
    menu.appendChild(btn);
  };

  const addSep = () => {
    const sep = document.createElement('div');
    sep.className = 'context-menu-sep';
    sep.setAttribute('role', 'separator');
    menu.appendChild(sep);
  };

  addItem('Mở thư mục', () => {
    void openTorrentFolder(infoHash);
  });

  addSep();

  addItem(isPaused ? 'Tiếp tục' : 'Tạm dừng', () => {
    void controlTorrentAction(infoHash, isPaused ? 'resume' : 'pause');
  });

  addItem('Dừng', () => {
    void controlTorrentAction(infoHash, 'stop');
  }, { disabled: status === 'stopped' });

  addSep();

  addItem('Xóa torrent', () => {
    if (!confirm('Xóa torrent khỏi danh sách?\nFile đã tải vẫn giữ trên đĩa.')) return;
    void controlTorrentAction(infoHash, 'delete');
  });

  addItem('Xóa torrent và file…', () => {
    if (!confirm('Xóa torrent và toàn bộ file đã tải?\nHành động này không thể hoàn tác.')) return;
    void controlTorrentAction(infoHash, 'delete', { deleteFiles: true });
  }, { danger: true });

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove('hidden');
  menu.setAttribute('aria-hidden', 'false');
  contextMenuOpen = true;

  const rect = menu.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
  if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

async function controlTorrentAction(infoHash, action, options = {}) {
  if (!window.api?.controlTorrent || !infoHash) return;
  try {
    await window.api.controlTorrent(infoHash, action, options);
  } catch (err) {
    alert(err?.message || 'Thao tác thất bại');
  }
}

function bindTorrentContextMenu() {
  contextMenuEl = document.getElementById('torrent-context-menu');
  if (!contextMenuEl) return;

  document.addEventListener('mousedown', (e) => {
    if (!contextMenuOpen) return;
    if (contextMenuEl?.contains(e.target)) return;
    hideTorrentContextMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTorrentContextMenu();
  });

  document.querySelector('.table-body')?.addEventListener('scroll', hideTorrentContextMenu, {
    passive: true,
  });

  window.addEventListener('blur', hideTorrentContextMenu);
}

/**
 * @param {string} infoHash
 */
function selectRow(infoHash) {
  if (selectedHash === infoHash) return;
  const prev = selectedHash ? rowByHash.get(selectedHash)?.tr : null;
  if (prev) prev.classList.remove('is-selected');

  selectedHash = infoHash;
  const row = rowByHash.get(infoHash)?.tr;
  if (row) row.classList.add('is-selected');
}

/**
 * @param {object} rowRefs
 * @param {object} torrent
 */
function patchTorrentRow(rowRefs, torrent) {
  const progress = Math.max(0, Math.min(100, Number(torrent.progress) || 0));
  const status = torrent.status || 'downloading';

  rowRefs.name.textContent = torrent.name || 'Torrent';
  rowRefs.name.title = torrent.name || '';
  rowRefs.size.textContent = formatBytes(torrent.size ?? torrent.length ?? 0);
  rowRefs.speed.textContent = formatSpeedCell(torrent);

  rowRefs.fill.style.width = `${progress}%`;
  rowRefs.fill.classList.toggle('is-complete', progress >= 100);
  rowRefs.fill.classList.toggle('is-paused', status === 'paused' || status === 'stopped');

  rowRefs.pct.textContent = formatProgressLabel(progress, status);
  rowRefs.tr.dataset.status = status;

  const track = rowRefs.fill.parentElement;
  if (track) {
    track.setAttribute('aria-valuenow', String(Math.round(progress)));
  }
}

/**
 * Cập nhật danh sách torrent — chỉ patch từng dòng theo infoHash.
 * @param {Array<{
 *   infoHash: string,
 *   name: string,
 *   size?: number,
 *   length?: number,
 *   progress: number,
 *   downloadSpeed?: number,
 *   uploadSpeed?: number,
 *   status?: string
 * }>} torrents
 */
function applySidebarFilter() {
  for (const [, refs] of rowByHash) {
    const status = refs.tr.dataset.status || '';
    let show = true;
    if (activeFilter === 'downloading') {
      show =
        status === 'downloading' ||
        status === 'restoring' ||
        (status !== 'seeding' && status !== 'paused' && status !== 'stopped' && status !== 'done');
    } else if (activeFilter === 'seeding') {
      show = status === 'seeding';
    }
    refs.tr.classList.toggle('hidden-row', !show);
  }
}

function updateEmptyState(count) {
  const empty = document.getElementById('empty-state');
  if (empty) empty.classList.toggle('hidden', count > 0);
}

function mapTorrentFromApi(t) {
  return {
    infoHash: t.infoHash,
    name: t.name,
    length: t.length,
    progress: t.progress ?? 0,
    downloadSpeed: t.downloadSpeed ?? 0,
    uploadSpeed: t.uploadSpeed ?? 0,
    status: t.status ?? 'downloading',
  };
}

function updateTorrentList(torrents) {
  const body = tbody();
  if (!body) return;

  const list = Array.isArray(torrents) ? torrents : [];
  lastTorrentList = list;
  const seen = new Set();

  for (const torrent of list) {
    const hash = torrent.infoHash;
    if (!hash) continue;
    seen.add(hash);

    let refs = rowByHash.get(hash);
    if (!refs) {
      const tr = createTorrentRow(torrent);
      body.appendChild(tr);
      refs = {
        tr,
        fill: tr.querySelector('.progress-fill'),
        pct: tr.querySelector('.progress-pct'),
        speed: tr.querySelector('.col-speed'),
        size: tr.querySelector('.col-size'),
        name: tr.querySelector('.torrent-name'),
      };
      rowByHash.set(hash, refs);
    }

    patchTorrentRow(refs, torrent);
  }

  for (const [hash, refs] of rowByHash) {
    if (!seen.has(hash)) {
      refs.tr.remove();
      rowByHash.delete(hash);
      if (selectedHash === hash) selectedHash = null;
    }
  }

  if (!selectedHash && rowByHash.size > 0) {
    selectRow(rowByHash.keys().next().value);
  }

  updateSidebarBadges(list);
  updateStatusBar(list);
  updateEmptyState(list.length);
  applySidebarFilter();
}

function updateSidebarBadges(torrents) {
  const all = torrents.length;
  const downloading = torrents.filter(
    (t) =>
      t.status === 'restoring' ||
      (t.progress < 100 && (t.downloadSpeed || 0) > 0 && t.status !== 'paused' && t.status !== 'stopped')
  ).length;
  const seeding = torrents.filter(
    (t) => t.status === 'seeding' || (t.progress >= 100 && (t.uploadSpeed || 0) > 0)
  ).length;

  const setBadge = (filter, n) => {
    const btn = document.querySelector(`.sidebar-item[data-filter="${filter}"] .sidebar-badge`);
    if (btn) btn.textContent = String(n);
  };

  setBadge('all', all);
  setBadge('downloading', downloading);
  setBadge('seeding', seeding);
}

function updateStatusBar(torrents) {
  let down = 0;
  let up = 0;
  let active = 0;

  for (const t of torrents) {
    down += t.downloadSpeed || 0;
    up += t.uploadSpeed || 0;
    if ((t.downloadSpeed || 0) > 0 || (t.uploadSpeed || 0) > 0) active += 1;
  }

  const elDown = statusDown();
  const elUp = statusUp();
  const elSum = statusSummary();

  if (elDown) elDown.textContent = `↓ ${formatSpeed(down)}`;
  if (elUp) elUp.textContent = `↑ ${formatSpeed(up)}`;
  if (elSum) elSum.textContent = `${torrents.length} torrent · ${active} active`;
}

/* ── Custom titlebar → IPC ────────────────────────────────────────────────── */
function bindWindowControls() {
  const wc = window.api?.windowControls;
  const btnMin = document.querySelector('.win-ctrl-minimize');
  const btnMax = document.querySelector('.win-ctrl-maximize');
  const btnClose = document.querySelector('.win-ctrl-close');

  if (!wc || !btnMin || !btnMax || !btnClose) {
    console.warn('[Renderer] windowControls IPC không khả dụng (chạy ngoài Electron?)');
    return;
  }

  const syncMaximize = async () => {
    try {
      const { maximized } = await wc.isMaximized();
      btnMax.classList.toggle('is-maximized', maximized);
      btnMax.title = maximized ? 'Khôi phục' : 'Phóng to';
    } catch { /* ignore */ }
  };

  btnMin.addEventListener('click', () => wc.minimize());
  btnMax.addEventListener('click', async () => {
    await wc.maximizeToggle();
    syncMaximize();
  });
  btnClose.addEventListener('click', () => wc.close());

  syncMaximize();
}

function bindSidebarFilters() {
  document.querySelectorAll('.sidebar-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-item').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      activeFilter = btn.dataset.filter || 'all';
      applySidebarFilter();
    });
  });
}

/* ── IPC torrent updates ──────────────────────────────────────────────────── */
function bindTorrentIPC() {
  if (!window.api?.onTorrentUpdate) return;

  window.api.onTorrentUpdate((torrents) => {
    updateTorrentList((torrents || []).map(mapTorrentFromApi));
  });

  window.api
    .listTorrents()
    .then((torrents) => updateTorrentList((torrents || []).map(mapTorrentFromApi)))
    .catch(() => {});

  window.api.onTorrentRemoved?.((infoHash) => {
    updateTorrentList(lastTorrentList.filter((t) => t.infoHash !== infoHash));
  });

  window.api.onError?.((payload) => {
    if (payload?.message) console.error('[My Torrent]', payload.message);
  });
}

function initApp() {
  if (!document.documentElement.classList.contains('platform-darwin') && window.api?.platform) {
    document.documentElement.classList.add(`platform-${window.api.platform}`);
  }

  bindWindowControls();
  bindSidebarFilters();
  bindTorrentContextMenu();
  bindTorrentIPC();
  updateEmptyState(0);

  if (window.TorrentAddUI) {
    const addDialog = new window.TorrentAddUI.AddTorrentDialog((source, dir, fileSelection) =>
      window.api.addTorrent(source, dir, { fileSelection })
    );
    window.TorrentAddUI.bindAddTorrentFeatures({ addDialog });
  }
}

function boot() {
  if (!window.api) {
    console.error('[My Torrent] Preload chưa load — window.api không tồn tại');
    return;
  }
  initApp();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

window.updateTorrentList = updateTorrentList;
