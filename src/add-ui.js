/**
 * UI thêm torrent — FileTreeView, AddTorrentDialog, toolbar, kéo-thả.
 * Phụ thuộc: window.api (preload), formatBytes() từ renderer.js
 */
const LAST_DIR_KEY = 'mytorrent:lastDownloadDir';
const ADD_DIALOG_TREE_KEY = 'add-dialog';

function parseMagnetLinks(text) {
  if (!text) return [];
  const links = [];
  const re = /magnet:\?[^\s<>"']+/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    links.push(match[0]);
  }
  return links;
}

function formatSourcePreview(type, source) {
  if (type === 'magnet') {
    return source.length > 120 ? `${source.slice(0, 117)}…` : source;
  }
  const parts = source.replace(/\\/g, '/').split('/');
  return `📄 ${parts[parts.length - 1]}\n${source}`;
}

function countFileLeaves(tree) {
  let maxIndex = -1;
  const walk = (node) => {
    if (node.type === 'file') {
      if (typeof node.index === 'number') maxIndex = Math.max(maxIndex, node.index);
      return;
    }
    for (const child of node.children || []) walk(child);
  };
  if (tree.type === 'directory' && tree.children) {
    for (const child of tree.children) walk(child);
  } else {
    walk(tree);
  }
  return maxIndex + 1;
}

class FileTreeView {
  constructor(container, opts = {}) {
    this.container = container;
    this.onToggle = opts.onToggle || (() => {});
    this.infoHash = null;
    this.leafRefs = new Map();
  }

  render(infoHash, tree) {
    if (this.infoHash === infoHash && this.container.childElementCount > 0) return;
    this.infoHash = infoHash;
    this.leafRefs.clear();
    this.container.replaceChildren();
    const frag = document.createDocumentFragment();
    if (tree.type === 'directory' && tree.children) {
      for (const child of tree.children) this._buildNodes(child, 0, frag, false);
    } else {
      this._buildNodes(tree, 0, frag, false);
    }
    this.container.appendChild(frag);
  }

  clear() {
    this.infoHash = null;
    this.leafRefs.clear();
    this.container.replaceChildren();
  }

  setAllSelected(selected) {
    for (const [index, ref] of this.leafRefs) {
      ref.checkbox.checked = selected;
      this.onToggle(index, selected);
    }
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
      for (const child of node.children) this._buildNodes(child, depth + 1, children, depth >= 1);
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
    checkbox.addEventListener('change', () => this.onToggle(node.index, checkbox.checked));
    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.textContent = '📄';
    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = node.name;
    name.title = node.path;
    const size = document.createElement('span');
    size.className = 'tree-size';
    size.textContent = formatBytes(node.size);
    row.append(toggle, checkbox, icon, name, size);
    this.leafRefs.set(node.index, { checkbox });
    return row;
  }
}

class AddTorrentDialog {
  constructor(onConfirm) {
    this.dialog = document.getElementById('add-torrent-dialog');
    this.sourcePreview = document.getElementById('add-source-preview');
    this.pathInput = document.getElementById('add-download-path');
    this.fileTreeStatus = document.getElementById('add-file-tree-status');
    this.confirmBtn = this.dialog?.querySelector('button[type="submit"]');
    this.onConfirm = onConfirm;
    this._pending = null;
    this._mode = null;
    this._previewInfoHash = null;
    this._selection = [];
    this._loadGeneration = 0;
    this._closeResolve = null;

    this.fileTreePicker = new FileTreeView(document.getElementById('add-file-tree'), {
      onToggle: (index, selected) => {
        this._selection[index] = selected;
      },
    });

    document.getElementById('add-browse-btn')?.addEventListener('click', () => this._browse());
    document.getElementById('add-select-all-btn')?.addEventListener('click', () => {
      this.fileTreePicker.setAllSelected(true);
    });
    document.getElementById('add-select-none-btn')?.addEventListener('click', () => {
      this.fileTreePicker.setAllSelected(false);
    });
    document.getElementById('add-change-source-btn')?.addEventListener('click', () => {
      void this._changeSource();
    });
    document.getElementById('add-cancel-btn')?.addEventListener('click', () => {
      this.dialog?.close('cancel');
    });
    this.dialog?.addEventListener('close', () => this._onClose());
    this.dialog?.addEventListener('cancel', () => this.dialog.close('cancel'));
  }

  _updateChangeSourceButton() {
    const btn = document.getElementById('add-change-source-btn');
    if (!btn || !this._pending) return;
    if (this._pending.type === 'magnet') {
      btn.textContent = 'Đổi magnet…';
      btn.title = 'Dán magnet link khác';
    } else {
      btn.textContent = 'Đổi file…';
      btn.title = 'Chọn file .torrent khác';
    }
  }

  async _changeSource() {
    if (!this._pending || !window.api) return;

    await this._cancelPreview();
    this._mode = null;

    if (this._pending.type === 'magnet') {
      await this._pickMagnetSource();
      return;
    }

    const filePath = await window.api.openTorrentFile();
    if (!filePath) return;

    this._pending = { type: 'torrent', source: filePath };
    this.sourcePreview.textContent = formatSourcePreview('torrent', filePath);
    this._updateChangeSourceButton();
    this._loadGeneration++;
    this.fileTreePicker.clear();
    this._setFileTreeLoading('Đang đọc danh sách file…');
    this._setConfirmEnabled(false);
    await this._loadFileList();
  }

  _pickMagnetSource() {
    return new Promise((resolve) => {
      const magnetDialog = document.getElementById('magnet-dialog');
      const input = document.getElementById('magnet-input');
      if (!magnetDialog || !input) {
        resolve();
        return;
      }

      const onClose = () => {
        if (magnetDialog.returnValue !== 'confirm') {
          resolve();
          return;
        }
        const uri = input.value.trim();
        if (!uri) {
          resolve();
          return;
        }
        this._pending = { type: 'magnet', source: uri };
        this.sourcePreview.textContent = formatSourcePreview('magnet', uri);
        this._updateChangeSourceButton();
        this._loadGeneration++;
        this.fileTreePicker.clear();
        this._setFileTreeLoading('Đang tải danh sách file…');
        this._setConfirmEnabled(false);
        void this._loadFileList().then(() => resolve());
      };

      input.value =
        this._pending?.type === 'magnet' && this._pending.source.startsWith('magnet:')
          ? this._pending.source
          : '';
      magnetDialog.addEventListener('close', onClose, { once: true });
      magnetDialog.showModal();
    });
  }

  async open(payload) {
    if (!this.dialog || !window.api) return;
    this._pending = payload;
    this._mode = null;
    this._previewInfoHash = null;
    this._selection = [];
    this.sourcePreview.textContent = formatSourcePreview(payload.type, payload.source);
    this._updateChangeSourceButton();
    const saved = localStorage.getItem(LAST_DIR_KEY);
    const fallback = await window.api.getDefaultDownloadDir();
    this.pathInput.value = saved || fallback || '';
    this.fileTreePicker.clear();
    this._setFileTreeLoading('Đang tải danh sách file…');
    this._setConfirmEnabled(false);
    this.dialog.showModal();
    this._loadFileList();
  }

  openAndWait(payload) {
    return new Promise((resolve) => {
      this._closeResolve = resolve;
      void this.open(payload);
    });
  }

  _finishClose(ok) {
    if (this._closeResolve) {
      const done = this._closeResolve;
      this._closeResolve = null;
      done(ok);
    }
  }

  _setFileTreeLoading(message) {
    this.fileTreeStatus.textContent = message;
    this.fileTreeStatus.className = 'file-tree-status loading';
  }

  _setFileTreeReady(message) {
    this.fileTreeStatus.textContent = message;
    this.fileTreeStatus.className = 'file-tree-status';
  }

  _setFileTreeError(message) {
    this.fileTreeStatus.textContent = message;
    this.fileTreeStatus.className = 'file-tree-status error';
  }

  _setConfirmEnabled(enabled) {
    if (this.confirmBtn) this.confirmBtn.disabled = !enabled;
  }

  _initSelectionFromTree(tree) {
    this._selection = new Array(countFileLeaves(tree)).fill(true);
  }

  _getFileSelection() {
    return this._selection.map((v) => v !== false);
  }

  _hasSelectedFile() {
    return this._selection.some((v) => v !== false);
  }

  async _loadFileList() {
    if (!this._pending) return;
    const gen = ++this._loadGeneration;
    const { source } = this._pending;
    const downloadPath = this.pathInput.value.trim();
    this.fileTreePicker.clear();
    this._setFileTreeLoading('Đang tải danh sách file…');
    this._setConfirmEnabled(false);
    try {
      const inspected = await window.api.inspectTorrentSource(source);
      if (gen !== this._loadGeneration) return;
      if (inspected.mode === 'static' && inspected.tree) {
        await this._cancelPreview();
        this._mode = 'static';
        this._initSelectionFromTree(inspected.tree);
        this.fileTreePicker.render(ADD_DIALOG_TREE_KEY, inspected.tree);
        this._setFileTreeReady(`${inspected.fileCount} file — chọn file cần tải`);
        this._setConfirmEnabled(true);
        return;
      }
      if (!downloadPath) {
        this._setFileTreeError('Chọn thư mục lưu để xem danh sách file (magnet)');
        return;
      }
      await this._startPreview(source, downloadPath, gen);
    } catch (err) {
      if (gen !== this._loadGeneration) return;
      this._setFileTreeError(err.message || 'Không đọc được danh sách file');
    }
  }

  async _startPreview(source, downloadPath, gen) {
    await this._cancelPreview();
    this._setFileTreeLoading('Đang lấy metadata torrent…');
    try {
      const result = await window.api.prepareTorrentPreview(source, downloadPath);
      if (gen !== this._loadGeneration) {
        await window.api.cancelTorrentPreview(result.infoHash).catch(() => {});
        return;
      }
      this._mode = 'preview';
      this._previewInfoHash = result.infoHash;
      this._initSelectionFromTree(result.tree);
      this.fileTreePicker.render(ADD_DIALOG_TREE_KEY, result.tree);
      this._setFileTreeReady(`${result.fileCount} file — chọn file cần tải`);
      this._setConfirmEnabled(true);
    } catch (err) {
      if (gen !== this._loadGeneration) return;
      this._setFileTreeError(err.message || 'Không lấy được metadata');
    }
  }

  async _cancelPreview() {
    if (!this._previewInfoHash) return;
    const hash = this._previewInfoHash;
    this._previewInfoHash = null;
    this._mode = null;
    await window.api.cancelTorrentPreview(hash).catch(() => {});
  }

  async _browse() {
    const dir = await window.api.selectDownloadDir();
    if (!dir) return;
    this.pathInput.value = dir;
    localStorage.setItem(LAST_DIR_KEY, dir);
    if (this._pending?.type === 'magnet') this._loadFileList();
  }

  async _onClose() {
    const wasConfirm = this.dialog.returnValue === 'confirm';
    const pending = this._pending;
    const previewHash = this._previewInfoHash;
    const mode = this._mode;

    if (!wasConfirm) {
      this._pending = null;
      this._loadGeneration++;
      await this._cancelPreview();
      this._finishClose(false);
      return;
    }

    if (!pending) {
      this._finishClose(false);
      return;
    }

    const downloadPath = this.pathInput.value.trim();
    if (!downloadPath) {
      alert('Vui lòng chọn thư mục lưu file.');
      this.dialog.showModal();
      return;
    }

    if (!this._hasSelectedFile()) {
      alert('Chọn ít nhất một file để tải.');
      this.dialog.showModal();
      return;
    }

    const fileSelection = this._getFileSelection();
    this._pending = null;
    this._loadGeneration++;
    localStorage.setItem(LAST_DIR_KEY, downloadPath);

    try {
      if (mode === 'preview' && previewHash) {
        this._previewInfoHash = null;
        this._mode = null;
        await window.api.confirmTorrentPreview(previewHash, fileSelection);
      } else {
        await this._cancelPreview();
        await this.onConfirm(pending.source, downloadPath, fileSelection);
      }
      this._finishClose(true);
    } catch (err) {
      alert(`Không thể thêm torrent: ${err.message || err}`);
      this._pending = pending;
      this.dialog.showModal();
    }
  }
}

function parseDropEvent(e) {
  const dt = e.dataTransfer;
  if (!dt) return [];
  const seen = new Set();
  const results = [];
  const add = (type, source) => {
    const key = `${type}:${source}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ type, source });
  };
  for (const file of dt.files) {
    if (!file.name.toLowerCase().endsWith('.torrent')) continue;
    let filePath = '';
    try {
      filePath = window.api.getPathForFile(file);
    } catch {
      filePath = file.path || '';
    }
    if (filePath) add('torrent', filePath);
  }
  const text = dt.getData('text/plain') || dt.getData('text/uri-list') || '';
  for (const magnet of parseMagnetLinks(text)) add('magnet', magnet);
  return results;
}

/**
 * @param {{ addDialog: AddTorrentDialog }} ctx
 */
function bindAddTorrentFeatures(ctx) {
  const { addDialog } = ctx;

  document.getElementById('btn-add-magnet')?.addEventListener('click', () => {
    const magnetDialog = document.getElementById('magnet-dialog');
    const input = document.getElementById('magnet-input');
    if (!magnetDialog || !input) return;
    input.value = '';
    magnetDialog.showModal();
  });

  document.getElementById('magnet-cancel')?.addEventListener('click', () => {
    document.getElementById('magnet-dialog')?.close('cancel');
  });

  document.getElementById('magnet-dialog')?.addEventListener('close', () => {
    const magnetDialog = document.getElementById('magnet-dialog');
    const input = document.getElementById('magnet-input');
    if (magnetDialog?.returnValue !== 'confirm' || !input) return;
    const uri = input.value.trim();
    if (!uri) return;
    addDialog.open({ type: 'magnet', source: uri });
  });

  document.getElementById('btn-add-torrent')?.addEventListener('click', async () => {
    try {
      const filePath = await window.api.openTorrentFile();
      if (filePath) addDialog.open({ type: 'torrent', source: filePath });
    } catch (err) {
      alert(err.message || 'Không mở được file .torrent');
    }
  });

  const panel = document.getElementById('torrent-panel');
  const overlay = document.getElementById('drop-overlay');
  if (!panel) return;

  let dragDepth = 0;

  panel.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth += 1;
    panel.classList.add('drag-over');
    overlay?.classList.remove('hidden');
  });

  panel.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  panel.addEventListener('dragleave', () => {
    dragDepth -= 1;
    if (dragDepth <= 0) {
      dragDepth = 0;
      panel.classList.remove('drag-over');
      overlay?.classList.add('hidden');
    }
  });

  panel.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    panel.classList.remove('drag-over');
    overlay?.classList.add('hidden');
    const sources = parseDropEvent(e);
    if (sources.length === 0) {
      alert('Chỉ hỗ trợ file .torrent hoặc magnet link.');
      return;
    }
    for (const payload of sources) {
      const ok = await addDialog.openAndWait(payload);
      if (!ok) break;
    }
  });

  document.addEventListener('dragover', (e) => e.preventDefault());
}

window.TorrentAddUI = { AddTorrentDialog, bindAddTorrentFeatures, parseMagnetLinks };
