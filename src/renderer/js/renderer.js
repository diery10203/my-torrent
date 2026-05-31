'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Utilities
   ═══════════════════════════════════════════════════════════════════════════ */

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatSpeed(bps) {
  return `${formatBytes(bps)}/s`;
}

function formatETA(seconds) {
  if (seconds == null || seconds === Infinity) return '∞';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const STATUS_MAP = {
  downloading: { label: 'Đang tải', cls: 'badge-downloading' },
  paused:      { label: 'Tạm dừng', cls: 'badge-paused' },
  seeding:     { label: 'Seeding',  cls: 'badge-seeding' },
  done:        { label: 'Hoàn thành', cls: 'badge-done' },
};

function statusMeta(status) {
  return STATUS_MAP[status] || STATUS_MAP.downloading;
}

const FILTER_FN = {
  all:         () => true,
  downloading: (t) => t.status === 'downloading',
  done:        (t) => t.status === 'done',
  seeding:     (t) => t.status === 'seeding',
  paused:      (t) => t.status === 'paused',
};

/* ═══════════════════════════════════════════════════════════════════════════
   TorrentTableView — incremental DOM patch, no full re-render
   ═══════════════════════════════════════════════════════════════════════════ */

class TorrentTableView {
  /**
   * @param {HTMLTableSectionElement} tbody
   * @param {{
   *   onSelect: (hash: string|null) => void,
   *   onContextMenu: (hash: string, x: number, y: number) => void,
   *   onDoubleClick: (hash: string) => void,
   * }} opts
   */
  constructor(tbody, opts = {}) {
    this.tbody = tbody;
    this.onSelect = opts.onSelect || (() => {});
    this.onContextMenu = opts.onContextMenu || (() => {});
    this.onDoubleClick = opts.onDoubleClick || (() => {});
    /** @type {Map<string, { tr: HTMLTableRowElement, refs: object, snap: object }>} */
    this.rows = new Map();
    this.selectedHash = null;
    this.activeFilter = 'all';
    this.searchQuery = '';
    /** @type {Map<string, object>} */
    this.data = new Map();

    // Event delegation — 1 listener cho toàn bộ tbody, ổn định khi patch rows
    this.tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-hash]');
      if (tr) this._select(tr.dataset.hash);
    });

    this.tbody.addEventListener('dblclick', (e) => {
      const tr = e.target.closest('tr[data-hash]');
      if (tr) {
        e.preventDefault();
        this._select(tr.dataset.hash);
        this.onDoubleClick(tr.dataset.hash);
      }
    });

    this.tbody.addEventListener('contextmenu', (e) => {
      const tr = e.target.closest('tr[data-hash]');
      if (!tr) return;
      e.preventDefault();
      e.stopPropagation();
      this._select(tr.dataset.hash);
      this.onContextMenu(tr.dataset.hash, e.clientX, e.clientY);
    });
  }

  /**
   * Patch table with new torrent array — O(n), only mutates changed cells.
   * @param {object[]} torrents
   */
  patch(torrents) {
    const incoming = new Map();

    for (const t of torrents) {
      incoming.set(t.infoHash, t);
    }

    for (const hash of this.rows.keys()) {
      if (!incoming.has(hash)) {
        this.rows.get(hash).tr.remove();
        this.rows.delete(hash);
        this.data.delete(hash);
        if (this.selectedHash === hash) {
          this.selectedHash = null;
          this.onSelect(null);
        }
      }
    }

    const frag = document.createDocumentFragment();

    for (const t of torrents) {
      let entry = this.rows.get(t.infoHash);

      if (!entry) {
        entry = this._createRow(t);
        this.rows.set(t.infoHash, entry);
        frag.appendChild(entry.tr);
      }

      this._patchRow(entry, t);
      this.data.set(t.infoHash, t);
    }

    if (frag.childNodes.length) {
      this.tbody.appendChild(frag);
    }

    this._applyVisibility();
  }

  setFilter(filter) {
    this.activeFilter = filter;
    this._applyVisibility();
  }

  setSearch(query) {
    this.searchQuery = query.toLowerCase();
    this._applyVisibility();
  }

  getSelected() {
    return this.selectedHash;
  }

  getSelectedData() {
    return this.selectedHash ? this.data.get(this.selectedHash) : null;
  }

  getData(infoHash) {
    return this.data.get(infoHash) || null;
  }

  /** @returns {Map<string, number>} filter → count */
  getFilterCounts() {
    const counts = { all: 0, downloading: 0, done: 0, seeding: 0, paused: 0 };
    for (const t of this.data.values()) {
      counts.all++;
      if (t.status in counts) counts[t.status]++;
    }
    return counts;
  }

  _applyVisibility() {
    const fn = FILTER_FN[this.activeFilter] || FILTER_FN.all;

    for (const [hash, entry] of this.rows) {
      const t = this.data.get(hash);
      const visible = fn(t) && (!this.searchQuery || t.name.toLowerCase().includes(this.searchQuery));
      entry.tr.classList.toggle('hidden-row', !visible);
    }
  }

  _createRow(t) {
    const tr = document.createElement('tr');
    tr.dataset.hash = t.infoHash;

    const refs = {};
    const cells = [
      ['name',     'td', 'col-name'],
      ['size',     'td', 'col-size'],
      ['progress', 'td', 'col-progress'],
      ['status',   'td', 'col-status'],
      ['down',     'td', 'col-down'],
      ['up',       'td', 'col-up'],
      ['peers',    'td', 'col-peers'],
      ['eta',      'td', 'col-eta'],
    ];

    for (const [key, tag, cls] of cells) {
      const td = document.createElement(tag);
      td.className = cls;

      if (key === 'progress') {
        const bar = document.createElement('div');
        bar.className = 'progress-bar';
        const fill = document.createElement('div');
        fill.className = 'progress-fill';
        const label = document.createElement('span');
        label.className = 'progress-label';
        bar.append(fill, label);
        td.appendChild(bar);
        refs.progressFill = fill;
        refs.progressLabel = label;
      } else if (key === 'status') {
        const badge = document.createElement('span');
        badge.className = 'badge';
        td.appendChild(badge);
        refs.statusBadge = badge;
      } else {
        refs[key] = td;
      }

      tr.appendChild(td);
    }

    return { tr, refs, snap: {} };
  }

  _select(hash) {
    const prev = this.selectedHash;

    if (prev && this.rows.has(prev)) {
      this.rows.get(prev).tr.classList.remove('selected');
    }

    this.selectedHash = hash;

    if (hash && this.rows.has(hash)) {
      this.rows.get(hash).tr.classList.add('selected');
    }

    // Luôn gọi onSelect — kể cả click lại cùng dòng (refresh panel)
    this.onSelect(hash);
  }

  _patchRow(entry, t) {
    const { refs, snap } = entry;
    const meta = statusMeta(t.status);
    const eta = t.status === 'seeding' || t.status === 'done' ? '—' : formatETA(t.eta);

    if (snap.name !== t.name) {
      refs.name.textContent = t.name;
      refs.name.title = t.name;
    }

    if (snap.length !== t.length) {
      refs.size.textContent = formatBytes(t.length);
    }

    if (snap.progress !== t.progress) {
      refs.progressFill.style.width = `${t.progress}%`;
      refs.progressLabel.textContent = `${t.progress.toFixed(1)}%`;
    }

    if (snap.status !== t.status) {
      refs.statusBadge.textContent = meta.label;
      refs.statusBadge.className = `badge ${meta.cls}`;
    }

    if (snap.downloadSpeed !== t.downloadSpeed) {
      refs.down.textContent = formatSpeed(t.downloadSpeed);
    }

    if (snap.uploadSpeed !== t.uploadSpeed) {
      refs.up.textContent = formatSpeed(t.uploadSpeed);
    }

    if (snap.numPeers !== t.numPeers) {
      refs.peers.textContent = String(t.numPeers);
    }

    if (snap.etaKey !== eta) {
      refs.eta.textContent = eta;
    }

    entry.snap = {
      name: t.name,
      length: t.length,
      progress: t.progress,
      status: t.status,
      downloadSpeed: t.downloadSpeed,
      uploadSpeed: t.uploadSpeed,
      numPeers: t.numPeers,
      etaKey: eta,
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   FileTreeView — collapsible tree with checkbox selection
   ═══════════════════════════════════════════════════════════════════════════ */

class FileTreeView {
  /**
   * @param {HTMLElement} container
   * @param {{ onToggle: (index: number, selected: boolean) => void }} opts
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.onToggle = opts.onToggle || (() => {});
    this.infoHash = null;
    /** @type {Map<number, { checkbox: HTMLInputElement, progressEl: HTMLElement }>} */
    this.leafRefs = new Map();
  }

  /**
   * Render tree once per torrent selection. Collapsed by default for perf.
   * @param {string} infoHash
   * @param {object} tree
   */
  render(infoHash, tree) {
    if (this.infoHash === infoHash && this.container.childElementCount > 0) {
      return;
    }

    this.infoHash = infoHash;
    this.leafRefs.clear();
    this.container.replaceChildren();

    const frag = document.createDocumentFragment();

    if (tree.type === 'directory' && tree.children) {
      for (const child of tree.children) {
        this._buildNodes(child, 0, frag, false);
      }
    } else {
      this._buildNodes(tree, 0, frag, false);
    }

    this.container.appendChild(frag);
  }

  patchVolatile(tree) {
    if (tree.type === 'directory' && tree.children) {
      for (const child of tree.children) {
        this._walkPatch(child);
      }
    } else {
      this._walkPatch(tree);
    }
  }

  clear() {
    this.infoHash = null;
    this.leafRefs.clear();
    this.container.replaceChildren();
  }

  _buildNodes(node, depth, parent, collapsed) {
    if (node.type === 'file') {
      parent.appendChild(this._createFileRow(node, depth));
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'tree-branch';

    const row = document.createElement('div');
    row.className = 'tree-node' + (collapsed && depth > 0 ? ' collapsed' : '');
    row.style.paddingLeft = `${8 + depth * 16}px`;

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = collapsed && depth > 0 ? '▶' : '▼';

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.textContent = '📁';

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = node.name || '(root)';

    const size = document.createElement('span');
    size.className = 'tree-size';
    size.textContent = formatBytes(node.size);

    row.append(toggle, icon, name, size);
    wrapper.appendChild(row);

    const children = document.createElement('div');
    children.className = 'tree-children';

    if (node.children) {
      for (const child of node.children) {
        this._buildNodes(child, depth + 1, children, depth >= 1);
      }
    }

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCollapsed = row.classList.toggle('collapsed');
      toggle.textContent = isCollapsed ? '▶' : '▼';
    });

    wrapper.appendChild(children);
    parent.appendChild(wrapper);
  }

  _createFileRow(node, depth) {
    const row = document.createElement('div');
    row.className = 'tree-node tree-file';
    row.style.paddingLeft = `${8 + depth * 16}px`;

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle empty';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'tree-checkbox';
    checkbox.checked = node.selected !== false;
    checkbox.addEventListener('change', () => {
      this.onToggle(node.index, checkbox.checked);
    });

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.textContent = '📄';

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = node.name;
    name.title = node.path;

    const progressEl = document.createElement('span');
    progressEl.className = 'tree-progress';
    progressEl.textContent = `${(node.progress || 0).toFixed(1)}%`;

    const size = document.createElement('span');
    size.className = 'tree-size';
    size.textContent = formatBytes(node.size);

    row.append(toggle, checkbox, icon, name, progressEl, size);
    this.leafRefs.set(node.index, { checkbox, progressEl });

    return row;
  }

  _walkPatch(node) {
    if (node.type === 'file') {
      const ref = this.leafRefs.get(node.index);
      if (ref) {
        ref.checkbox.checked = node.selected !== false;
        ref.progressEl.textContent = `${(node.progress || 0).toFixed(1)}%`;
      }
      return;
    }
    if (node.children) {
      for (const child of node.children) {
        this._walkPatch(child);
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TorrentContextMenu — menu chuột phải
   ═══════════════════════════════════════════════════════════════════════════ */

class TorrentContextMenu {
  /**
   * @param {(action: string, infoHash: string) => void} onAction
   */
  constructor(onAction) {
    this.el = document.getElementById('torrent-context-menu');
    this.onAction = onAction;
    /** @type {string | null} */
    this._hash = null;

    if (!this.el) {
      console.error('[My Torrent] #torrent-context-menu không tìm thấy trong DOM');
      return;
    }

    this.el.querySelectorAll('.context-menu-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const hash = this._hash;
        this.hide();
        if (hash && action) this.onAction(action, hash);
      });
    });

    // Đóng menu khi click ra ngoài (không dùng contextmenu ở document — sẽ đóng ngay khi mở)
    document.addEventListener('mousedown', (e) => {
      if (this.el.classList.contains('hidden')) return;
      if (this.el.contains(e.target)) return;
      this.hide();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });

    window.addEventListener('blur', () => this.hide());
    window.addEventListener('resize', () => this.hide());
    window.addEventListener('scroll', () => this.hide(), true);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} infoHash
   * @param {object | null} torrent
   */
  show(x, y, infoHash, torrent) {
    if (!this.el) return;

    this._hash = infoHash;

    const paused = torrent?.status === 'paused';
    this._setDisabled('resume', !paused);
    this._setDisabled('pause', paused);
    this._setDisabled('stop', false);
    this._setDisabled('open-folder', !torrent?.path);
    this._setDisabled('delete', false);

    this.el.classList.remove('hidden');
    this.el.style.visibility = 'hidden';
    this.el.style.left = '0';
    this.el.style.top = '0';

    const rect = this.el.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    this.el.style.left = `${Math.max(4, Math.min(x, maxX))}px`;
    this.el.style.top = `${Math.max(4, Math.min(y, maxY))}px`;
    this.el.style.visibility = '';
  }

  hide() {
    if (!this.el) return;
    this.el.classList.add('hidden');
    this._hash = null;
  }

  _setDisabled(action, disabled) {
    const btn = this.el.querySelector(`[data-action="${action}"]`);
    if (btn) btn.disabled = disabled;
  }
}

const LAST_DIR_KEY = 'mytorrent:lastDownloadDir';

function formatSourcePreview(type, source) {
  if (type === 'magnet') {
    return source.length > 120 ? `${source.slice(0, 117)}…` : source;
  }
  const parts = source.replace(/\\/g, '/').split('/');
  return `📄 ${parts[parts.length - 1]}\n${source}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   AddTorrentDialog — chọn thư mục lưu trước khi tải
   ═══════════════════════════════════════════════════════════════════════════ */

class AddTorrentDialog {
  /**
   * @param {(source: string, downloadPath: string) => Promise<void>} onConfirm
   */
  constructor(onConfirm) {
    this.dialog = document.getElementById('add-torrent-dialog');
    this.sourcePreview = document.getElementById('add-source-preview');
    this.pathInput = document.getElementById('add-download-path');
    this.onConfirm = onConfirm;
    /** @type {{ type: string, source: string } | null} */
    this._pending = null;

    document.getElementById('add-browse-btn').addEventListener('click', () => this._browse());

    document.getElementById('add-cancel-btn').addEventListener('click', () => {
      this._pending = null;
      this.dialog.close('cancel');
    });

    this.dialog.addEventListener('close', () => this._onClose());
  }

  async open(payload) {
    this._pending = payload;
    this.sourcePreview.textContent = formatSourcePreview(payload.type, payload.source);

    const saved = localStorage.getItem(LAST_DIR_KEY);
    const fallback = await window.api.getDefaultDownloadDir();
    this.pathInput.value = saved || fallback || '';

    this.dialog.showModal();
  }

  async _browse() {
    const dir = await window.api.selectDownloadDir();
    if (dir) {
      this.pathInput.value = dir;
      localStorage.setItem(LAST_DIR_KEY, dir);
    }
  }

  async _onClose() {
    if (this.dialog.returnValue !== 'confirm' || !this._pending) {
      this._pending = null;
      return;
    }

    const downloadPath = this.pathInput.value.trim();
    if (!downloadPath) {
      alert('Vui lòng chọn thư mục lưu file.');
      this.open(this._pending);
      return;
    }

    const { source } = this._pending;
    this._pending = null;
    localStorage.setItem(LAST_DIR_KEY, downloadPath);

    try {
      await this.onConfirm(source, downloadPath);
    } catch (err) {
      console.error('[My Torrent] addTorrent failed:', err.message || err);
      alert(`Không thể thêm torrent: ${err.message || err}`);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   App — wires IPC, layout, toolbar
   ═══════════════════════════════════════════════════════════════════════════ */

class App {
  constructor() {
    this.allTorrents = [];

    this.els = {
      tbody:          document.getElementById('torrent-tbody'),
      emptyState:     document.getElementById('empty-state'),
      bottomPanel:    document.getElementById('bottom-panel'),
      mainColumn:     document.querySelector('.main-column'),
      fileTree:       document.getElementById('file-tree'),
      fileTreeStatus: document.getElementById('file-tree-status'),
      torrentInfo:    document.getElementById('torrent-info'),
      panelResizer:   document.getElementById('panel-resizer'),
      globalDown:     document.getElementById('global-down'),
      globalUp:       document.getElementById('global-up'),
      globalPeers:    document.getElementById('global-peers'),
      statusLabel:    document.getElementById('status-label'),
      magnetDialog:   document.getElementById('magnet-dialog'),
      magnetInput:    document.getElementById('magnet-input'),
    };

    this.table = new TorrentTableView(this.els.tbody, {
      onSelect: (hash) => this._onTorrentSelect(hash),
      onContextMenu: (hash, x, y) => this._onTorrentContextMenu(hash, x, y),
      onDoubleClick: (hash) => this._openTorrentFolder(hash),
    });

    this.contextMenu = new TorrentContextMenu((action, hash) => this._contextAction(action, hash));

    this.fileTree = new FileTreeView(this.els.fileTree, {
      onToggle: (index, selected) => this._onFileToggle(index, selected),
    });

    this.addDialog = new AddTorrentDialog((source, dir) => window.api.addTorrent(source, dir));

    this._fileTreeRefreshTimer = null;
  }

  async init() {
    if (!window.api) {
      console.error('[My Torrent] window.api không tồn tại — preload chưa load đúng');
      this.els.emptyState.classList.remove('hidden');
      this.els.emptyState.querySelector('.empty-title').textContent = 'Lỗi khởi tạo';
      this.els.emptyState.querySelector('.empty-hint').textContent =
        'Preload script thất bại. Kiểm tra DevTools Console.';
      return;
    }

    this._bindToolbar();
    this._bindSidebar();
    this._bindTabs();
    this._bindResizer();
    this._bindIPC();

    try {
      const torrents = await window.api.listTorrents();
      this._handleUpdate(torrents);
    } catch (err) {
      console.error('[My Torrent] listTorrents failed:', err);
    }
  }

  _bindIPC() {
    window.api.onTorrentUpdate((torrents) => this._handleUpdate(torrents));

    window.api.onTorrentRemoved((hash) => {
      this._handleUpdate(this.allTorrents.filter((t) => t.infoHash !== hash));
      if (this.table.getSelected() === hash) {
        this._closeBottomPanel();
      }
    });

    window.api.onMetadataReady(({ infoHash, tree }) => {
      if (this.table.getSelected() === infoHash) {
        this.fileTree.render(infoHash, tree);
        this._setFileTreeStatus('');
      }
    });

    window.api.onFileSelectionChanged(({ infoHash, fileIndex, selected }) => {
      if (this.table.getSelected() === infoHash) {
        const ref = this.fileTree.leafRefs.get(fileIndex);
        if (ref) ref.checkbox.checked = selected;
      }
    });

    window.api.onError(({ message }) => {
      console.error('[torrent]', message);
    });

    window.api.onTorrentPending((payload) => {
      this.addDialog.open(payload);
    });
  }

  /** @param {{ type: 'magnet'|'torrent', source: string }} payload */
  promptAddTorrent(payload) {
    this.addDialog.open(payload);
  }

  _onTorrentContextMenu(hash, x, y) {
    const torrent = this.table.getData(hash);
    this.contextMenu.show(x, y, hash, torrent);
  }

  async _contextAction(action, hash) {
    try {
      switch (action) {
        case 'resume':
          await window.api.controlTorrent(hash, 'resume');
          break;
        case 'pause':
          await window.api.controlTorrent(hash, 'pause');
          break;
        case 'stop':
          if (confirm('Dừng torrent và gỡ khỏi danh sách?\n(File đã tải vẫn giữ trên ổ đĩa)')) {
            await window.api.controlTorrent(hash, 'stop');
          }
          break;
        case 'open-folder':
          await this._openTorrentFolder(hash);
          break;
        case 'delete':
          if (confirm('Xóa torrent và tất cả file đã tải?\nHành động này không thể hoàn tác.')) {
            await window.api.controlTorrent(hash, 'delete', { deleteFiles: true });
          }
          break;
      }
    } catch (err) {
      console.error('[My Torrent] context action failed:', err);
      alert(err.message || String(err));
    }
  }

  async _openTorrentFolder(hash) {
    try {
      await window.api.openTorrentFolder(hash);
    } catch (err) {
      alert(err.message || String(err));
    }
  }

  _handleUpdate(torrents) {
    this.allTorrents = torrents;
    this.table.patch(torrents);
    this._updateSidebarCounts();
    this._updateStatusBar(torrents);
    this.els.emptyState.classList.toggle('hidden', torrents.length > 0);

    const selected = this.table.getSelected();
    if (selected && this.els.bottomPanel.classList.contains('open')) {
      this._scheduleFileTreeRefresh(selected);
    }
  }

  _updateStatusBar(torrents) {
    let down = 0, up = 0, peers = 0;
    for (const t of torrents) {
      down += t.downloadSpeed;
      up += t.uploadSpeed;
      peers += t.numPeers;
    }
    this.els.globalDown.textContent = `↓ ${formatSpeed(down)}`;
    this.els.globalUp.textContent = `↑ ${formatSpeed(up)}`;
    this.els.globalPeers.textContent = `Peers: ${peers}`;
    this.els.statusLabel.textContent = `${torrents.length} torrent${torrents.length !== 1 ? 's' : ''}`;
  }

  _updateSidebarCounts() {
    const counts = this.table.getFilterCounts();
    document.querySelectorAll('[data-count]').forEach((el) => {
      el.textContent = counts[el.dataset.count] ?? 0;
    });
  }

  _bindSidebar() {
    document.querySelectorAll('.sidebar-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelector('.sidebar-item.active')?.classList.remove('active');
        btn.classList.add('active');
        this.table.setFilter(btn.dataset.filter);
      });
    });

    document.getElementById('search-input').addEventListener('input', (e) => {
      this.table.setSearch(e.target.value);
    });
  }

  _bindTabs() {
    document.querySelectorAll('.bottom-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelector('.bottom-tab.active')?.classList.remove('active');
        document.querySelector('.tab-pane.active')?.classList.remove('active');
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
      });
    });
  }

  _bindResizer() {
    const resizer = this.els.panelResizer;
    let startY = 0;
    let startH = 0;

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startY = e.clientY;
      startH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bottom-panel-h'), 10);

      const onMove = (ev) => {
        const delta = startY - ev.clientY;
        const h = Math.max(80, Math.min(500, startH + delta));
        document.documentElement.style.setProperty('--bottom-panel-h', `${h}px`);
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  _bindToolbar() {
    const { magnetDialog, magnetInput } = this.els;

    document.getElementById('btn-add-magnet').addEventListener('click', () => {
      magnetInput.value = '';
      magnetDialog.showModal();
    });

    document.getElementById('magnet-cancel').addEventListener('click', () => {
      magnetDialog.close('cancel');
    });

    magnetDialog.addEventListener('close', () => {
      if (magnetDialog.returnValue !== 'confirm') return;
      const uri = magnetInput.value.trim();
      if (!uri) return;
      this.promptAddTorrent({ type: 'magnet', source: uri });
    });

    document.getElementById('btn-add-torrent').addEventListener('click', async () => {
      try {
        const filePath = await window.api.openTorrentFile();
        if (filePath) {
          this.promptAddTorrent({ type: 'torrent', source: filePath });
        }
      } catch (err) {
        console.error('Add torrent file failed:', err.message || err);
      }
    });

    document.getElementById('btn-pause').addEventListener('click', async () => {
      const hash = this.table.getSelected();
      if (hash) await window.api.controlTorrent(hash, 'pause');
    });

    document.getElementById('btn-resume').addEventListener('click', async () => {
      const hash = this.table.getSelected();
      if (hash) await window.api.controlTorrent(hash, 'resume');
    });

    document.getElementById('btn-remove').addEventListener('click', async () => {
      const hash = this.table.getSelected();
      if (!hash) return;
      if (confirm('Dừng torrent và gỡ khỏi danh sách?\n(File đã tải vẫn giữ trên ổ đĩa)')) {
        await window.api.controlTorrent(hash, 'stop');
      }
    });

    document.getElementById('btn-settings').addEventListener('click', async () => {
      const dir = await window.api.selectDownloadDir();
      if (dir) localStorage.setItem(LAST_DIR_KEY, dir);
    });
  }

  async _onTorrentSelect(hash) {
    if (!hash) {
      this._closeBottomPanel();
      return;
    }

    this.els.bottomPanel.classList.add('open');
    this.els.mainColumn.classList.add('panel-open');
    this._activateTab('files');
    this._renderGeneralInfo(this.table.getSelectedData());
    this._setFileTreeStatus('Đang tải danh sách file…', 'loading');
    this.fileTree.clear();

    try {
      const tree = await window.api.getFileTree(hash);
      this.fileTree.render(hash, tree);
      this._setFileTreeStatus('');
    } catch (err) {
      const msg = err?.message || String(err);
      if (/metadata|METADATA/i.test(msg)) {
        this._setFileTreeStatus('Đang chờ metadata torrent… (magnet link cần vài giây)', 'loading');
      } else {
        this._setFileTreeStatus(`Không tải được file tree: ${msg}`, 'error');
        console.error('[My Torrent] getFileTree:', err);
      }
    }
  }

  _setFileTreeStatus(text, type = '') {
    const el = this.els.fileTreeStatus;
    el.textContent = text;
    el.className = 'file-tree-status' + (type ? ` ${type}` : '');
    el.hidden = !text;
  }

  _activateTab(tabName) {
    document.querySelectorAll('.bottom-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-pane').forEach((p) => {
      p.classList.toggle('active', p.id === `tab-${tabName}`);
    });
  }

  _closeBottomPanel() {
    this.els.bottomPanel.classList.remove('open');
    this.els.mainColumn.classList.remove('panel-open');
    this.fileTree.clear();
    this._setFileTreeStatus('Chọn một torrent để xem danh sách file');
    this.els.torrentInfo.replaceChildren();
  }

  _renderGeneralInfo(t) {
    const dl = this.els.torrentInfo;
    dl.replaceChildren();
    if (!t) return;

    const fields = [
      ['Tên', t.name],
      ['Info Hash', t.infoHash],
      ['Dung lượng', formatBytes(t.length)],
      ['Tiến độ', `${t.progress.toFixed(1)}%`],
      ['Trạng thái', statusMeta(t.status).label],
      ['Thư mục', t.path || '—'],
    ];

    for (const [label, value] of fields) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      dl.append(dt, dd);
    }
  }

  async _onFileToggle(index, selected) {
    const hash = this.table.getSelected();
    if (!hash) return;
    try {
      await window.api.toggleFileSelection(hash, index, selected);
    } catch (err) {
      console.error('Toggle file failed:', err.message || err);
      const ref = this.fileTree.leafRefs.get(index);
      if (ref) ref.checkbox.checked = !selected;
    }
  }

  /** Debounced file-tree progress refresh — max once every 3s while panel open */
  _scheduleFileTreeRefresh(infoHash) {
    if (this._fileTreeRefreshTimer) return;

    this._fileTreeRefreshTimer = setTimeout(async () => {
      this._fileTreeRefreshTimer = null;
      if (this.table.getSelected() !== infoHash) return;
      if (!this.els.bottomPanel.classList.contains('open')) return;

      try {
        const tree = await window.api.getFileTree(infoHash);
        this.fileTree.patchVolatile(tree);
      } catch { /* metadata not ready */ }
    }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new App().init().catch((err) => console.error('[My Torrent] init error:', err));
});
