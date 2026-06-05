/**
 * Cấu hình tối ưu tốc độ tải cho WebTorrent (desktop).
 * Chỉ áp dụng tracker mặc định cho torrent không private.
 */

/** Tracker công khai — giúp magnet ít tracker vẫn tìm được peer */
const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker-udp.gbitt.info:80/announce',
  'udp://run.publictracker.xyz:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://open.tracker.cl:1337/announce',
];

/** @type {import('webtorrent').default.Options} */
const CLIENT_OPTS = {
  maxConns: 128,
  dht: true,
  lsd: true,
  utPex: true,
  utp: true,
  natUpnp: true,
  natPmp: true,
  webSeeds: true,
  downloadLimit: -1,
  uploadLimit: -1,
  tracker: {
    announce: PUBLIC_TRACKERS,
  },
};

/** Tùy chọn mỗi torrent — merge khi client.add() */
const TORRENT_OPTS = {
  /** rarest thường nhanh hơn sequential khi tải cả gói */
  strategy: 'rarest',
  /** Nhiều slot upload hơn → peer unchoke tốt hơn (tit-for-tat) */
  uploads: 16,
  maxWebConns: 8,
  /** Cache piece trong RAM — giảm nghẽn ghi đĩa */
  storeCacheSlots: 64,
};

module.exports = {
  PUBLIC_TRACKERS,
  CLIENT_OPTS,
  TORRENT_OPTS,
};
