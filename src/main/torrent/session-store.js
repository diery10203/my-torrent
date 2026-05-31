const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const SESSION_FILE = 'session.json';

function getSessionPath() {
  return path.join(app.getPath('userData'), SESSION_FILE);
}

/**
 * @returns {Promise<Array<{
 *   torrentId: string,
 *   downloadPath: string,
 *   infoHash?: string,
 *   magnetURI?: string,
 *   stopped?: boolean,
 *   paused?: boolean,
 * }>>}
 */
async function loadSession() {
  try {
    const raw = await fs.promises.readFile(getSessionPath(), 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data?.torrents) ? data.torrents : [];
  } catch {
    return [];
  }
}

/**
 * @param {object[]} torrents
 */
async function saveSession(torrents) {
  const filePath = getSessionPath();
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

  const payload = JSON.stringify({ version: 1, torrents }, null, 2);
  const tmpPath = `${filePath}.tmp`;

  await fs.promises.writeFile(tmpPath, payload, 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}

module.exports = { loadSession, saveSession };
