/**
 * Build a directory tree from a flat file list in a single O(n) pass.
 * Uses a path-indexed Map for O(1) directory lookups per path segment.
 *
 * @param {Array<{ path: string, length: number }>} files
 * @returns {{ root: object, leaves: object[] }}
 */
function buildFileTree(files) {
  const root = {
    type: 'directory',
    name: '',
    path: '',
    size: 0,
    children: [],
  };

  /** @type {Map<string, object>} */
  const dirMap = new Map([['', root]]);
  const leaves = new Array(files.length);

  for (let index = 0; index < files.length; index++) {
    const filePath = files[index].path;
    const fileSize = files[index].length;
    const segments = filePath.split('/');

    let parent = root;
    let dirPath = '';

    for (let d = 0; d < segments.length - 1; d++) {
      const segment = segments[d];
      dirPath = dirPath ? `${dirPath}/${segment}` : segment;

      let dir = dirMap.get(dirPath);
      if (!dir) {
        dir = {
          type: 'directory',
          name: segment,
          path: dirPath,
          size: 0,
          children: [],
        };
        dirMap.set(dirPath, dir);
        parent.children.push(dir);
      }
      parent = dir;
    }

    const name = segments[segments.length - 1];
    const leaf = {
      type: 'file',
      name,
      path: filePath,
      size: fileSize,
      index,
      selected: true,
      progress: 0,
    };

    parent.children.push(leaf);
    leaves[index] = leaf;

    let accumPath = '';
    for (let d = 0; d < segments.length - 1; d++) {
      accumPath = accumPath ? `${accumPath}/${segments[d]}` : segments[d];
      dirMap.get(accumPath).size += fileSize;
    }
    root.size += fileSize;
  }

  sortTreeChildren(root);
  return { root, leaves };
}

/**
 * Sort directory children: folders first, then files, alphabetical (in-place).
 * @param {object} node
 */
function sortTreeChildren(node) {
  if (node.type !== 'directory') return;

  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  for (const child of node.children) {
    if (child.type === 'directory') sortTreeChildren(child);
  }
}

/**
 * Refresh volatile fields (selected, progress) on cached leaf nodes — O(n), no rebuild.
 *
 * @param {{ leaves: object[], selection: Uint8Array }} cache
 * @param {Array<{ progress: number }>} torrentFiles
 */
function refreshFileTreeVolatile(cache, torrentFiles) {
  const { leaves, selection } = cache;
  const count = leaves.length;

  for (let i = 0; i < count; i++) {
    const leaf = leaves[i];
    leaf.selected = selection[i] === 1;
    leaf.progress = Math.round(torrentFiles[i].progress * 1000) / 10;
  }
}

module.exports = { buildFileTree, refreshFileTreeVolatile };
