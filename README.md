# My Torrent

Ứng dụng BitTorrent client desktop đa nền tảng cho **macOS** và **Windows**, xây dựng bằng **Electron** và **WebTorrent**. Giao diện lấy cảm hứng từ qBittorrent — dark mode, bảng torrent, sidebar lọc trạng thái, và panel xem file tree bên dưới.

## Tính năng

- **Quản lý torrent** — thêm magnet link hoặc file `.torrent`, pause / resume / xóa
- **Chọn thư mục lưu** — dialog chọn nơi tải về trước khi bắt đầu (nhớ thư mục gần nhất)
- **Bắt magnet tự động** — đăng ký protocol handler `magnet:` và file `.torrent` (sau khi build)
- **Theo dõi realtime** — tiến độ, tốc độ up/down, peers, ETA cập nhật mỗi giây
- **File tree** — xem cấu trúc thư mục trong torrent, chọn/bỏ chọn từng file
- **Lọc trạng thái** — Tất cả, Đang tải, Đã xong, Đang Seed, Đã tạm dừng

## Công nghệ

| Thành phần | Công nghệ |
|-----------|-----------|
| Desktop shell | Electron 35 |
| Core torrent | WebTorrent 2 |
| Frontend | HTML / CSS / Vanilla JS |
| Build | electron-builder |
| IPC | contextBridge + preload (sandbox) |

## Kiến trúc

```
┌─────────────────────────────────────────────────────────┐
│  Renderer (src/renderer/)                               │
│  HTML/CSS/JS — không có quyền Node.js                   │
│  Gọi window.api.*                                       │
└──────────────────────┬──────────────────────────────────┘
                       │ contextBridge (preload)
┌──────────────────────▼──────────────────────────────────┐
│  Preload (src/preload/preload.js)                       │
│  Whitelist IPC channels — invoke / subscribe            │
└──────────────────────┬──────────────────────────────────┘
                       │ ipcMain.handle / webContents.send
┌──────────────────────▼──────────────────────────────────┐
│  Main Process (src/main/)                               │
│  TorrentManager · protocol handler · native dialogs     │
└─────────────────────────────────────────────────────────┘
```

**Bảo mật:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Renderer chỉ truy cập main process qua API `window.api` đã expose sẵn.

## Cấu trúc thư mục

```
my-torrent/
├── src/
│   ├── main/                  # Main process
│   │   ├── index.js           # Entry point
│   │   ├── window.js          # BrowserWindow
│   │   ├── protocol.js        # Magnet / .torrent handler
│   │   ├── ipc/
│   │   │   ├── channels.js
│   │   │   └── handlers.js
│   │   └── torrent/
│   │       ├── TorrentManager.js
│   │       ├── client.js
│   │       └── file-tree.js
│   ├── preload/
│   │   └── preload.js         # contextBridge → window.api
│   ├── renderer/              # UI
│   │   ├── index.html
│   │   ├── css/styles.css
│   │   └── js/renderer.js
│   └── shared/
│       └── ipc-channels.js    # Tên channel IPC (main)
├── assets/                    # Icons, entitlements macOS
├── electron-builder.yml       # Cấu hình build
└── package.json
```

## Yêu cầu

- Node.js ≥ 20
- npm

## Chạy development

```bash
npm install
npm start
```

DevTools tự mở khi `NODE_ENV=development`.

## Build

```bash
# macOS (.dmg + .zip)
npm run build:mac

# Windows (NSIS installer)
npm run build:win

# Cả hai
npm run build:all
```

Output nằm trong thư mục `dist/`.

Trước khi build release, thêm icon vào:
- `assets/icons/icon.icns` (macOS)
- `assets/icons/icon.ico` (Windows)

## Sử dụng

### Thêm torrent thủ công

1. Nút **+** — dán magnet link → chọn thư mục lưu → **Bắt đầu tải**
2. Nút **📄** — chọn file `.torrent` → chọn thư mục lưu

### Magnet link từ browser

Sau khi cài bản build, app đăng ký làm handler mặc định cho `magnet:` và `.torrent`. Click magnet link trên web sẽ mở My Torrent và hiện dialog chọn thư mục.

> **Dev mode:** macOS có thể chưa nhận Electron làm handler mặc định. Cần build và cài app, hoặc đăng ký thủ công trong System Settings.

### Xem file trong torrent

Click một dòng trên bảng → bottom panel hiện tab **Tệp tin** (tree view) và **Thông tin**.

## API Renderer (`window.api`)

| Method | Mô tả |
|--------|-------|
| `addTorrent(id, downloadPath?)` | Thêm magnet hoặc đường dẫn `.torrent` |
| `controlTorrent(infoHash, action)` | `pause` · `resume` · `delete` |
| `listTorrents()` | Lấy danh sách torrent |
| `getFileTree(infoHash)` | Cây file của torrent |
| `toggleFileSelection(infoHash, index, selected)` | Bật/tắt tải từng file |
| `selectDownloadDir()` | Mở dialog chọn thư mục |
| `onTorrentUpdate(callback)` | Nhận stats realtime (~1s) |
| `onMetadataReady(callback)` | Metadata + file tree sẵn sàng |
| `onTorrentPending(callback)` | Magnet/file mở từ bên ngoài |

## Scripts

| Lệnh | Mô tả |
|------|-------|
| `npm start` | Chạy app |
| `npm run dev` | Chạy với logging |
| `npm run build:mac` | Build macOS |
| `npm run build:win` | Build Windows |
| `npm run rebuild` | Rebuild native modules |

## License

MIT
