function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatSpeed(bytesPerSec) {
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatETA(seconds) {
  if (!seconds || seconds === Infinity) return '∞';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatProgress(progress) {
  return `${(progress * 100).toFixed(1)}%`;
}

function getStatus(torrent) {
  if (torrent.paused) return { label: 'Tạm dừng', cls: 'badge-paused' };
  if (torrent.done) return { label: 'Seeding', cls: 'badge-seeding' };
  if (torrent.progress >= 1) return { label: 'Hoàn thành', cls: 'badge-completed' };
  return { label: 'Đang tải', cls: 'badge-downloading' };
}
