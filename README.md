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
│  Renderer (src/index.html + JS)                         │
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
│   │   ├── main.js            # BrowserWindow (glass)
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
│   ├── index.html             # UI (glass)
│   ├── style.css
│   ├── renderer.js            # Bảng torrent + IPC
│   ├── add-ui.js              # Thêm magnet / .torrent
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
npm run dev
```

`npm run dev` dùng **nodemon** — tự khởi động lại app khi sửa file trong `src/`.

```bash
npm run dev:log   # dev + --enable-logging (DevTools)
npm start         # chạy một lần, không watch
```

DevTools tự mở khi `NODE_ENV=development` (mặc định với `npm run dev`).

## Build thành app cài đặt

### Bước 1 — Cài dependencies

```bash
npm install
```

### Bước 2 — Build theo nền tảng

```bash
# macOS (bạn đang dùng Mac → dùng lệnh này)
npm run build:mac

# Windows (cần chạy trên máy Windows, hoặc dùng CI)
npm run build:win

# Cả macOS + Windows
npm run build:all
```

### Bước 3 — Lấy file cài đặt

Sau khi build xong, mở thư mục `dist/`:

| File | Dùng cho |
|------|----------|
| `My Torrent-0.1.0.dmg` | Mac Intel — double-click để cài |
| `My Torrent-0.1.0-arm64.dmg` | Mac Apple Silicon (M1/M2/M3) |
| `My Torrent-0.1.0-mac.zip` | Mac Intel — bản zip portable |
| `My Torrent-0.1.0-arm64-mac.zip` | Mac Apple Silicon — bản zip |
| `My Torrent Setup 0.1.0.exe` | Windows (sau `build:win`) |

**Mac Apple Silicon:** dùng file `-arm64.dmg`.  
**Mac Intel:** dùng file `.dmg` không có `-arm64`.

Cài trên macOS:
```bash
open dist/My\ Torrent-0.1.0-arm64.dmg   # Apple Silicon
# Kéo "My Torrent" vào Applications
```

### Lưu ý khi build

1. **Icon** — hiện dùng `assets/icon.png` (512×512). Thay file này bằng icon đẹp hơn trước khi release.
2. **Code signing (macOS)** — build dev không ký certificate. Lần đầu mở, macOS có thể cảnh báo → **System Settings → Privacy & Security → Open Anyway**.
3. **Magnet handler** — chỉ hoạt động đúng sau khi **cài app build**, không phải `npm start`.
4. **Build Windows trên Mac** — cần Wine (phức tạp). Nên build Windows trên máy Windows hoặc GitHub Actions.

### Lỗi thường gặp

| Lỗi | Cách xử lý |
|-----|------------|
| `node-gyp` / `distutils` khi build | Đã tắt `npmRebuild` trong config — chạy lại `npm run build:mac` |
| `icon directory doesn't contain icons` | Đảm bảo có file `assets/icon.png` |
| App bị Gatekeeper chặn | Click phải → Open, hoặc ký app bằng Apple Developer ID |

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
| `npm start` | Chạy app (không tự reload) |
| `npm run dev` | Dev + nodemon (tự restart khi đổi code) |
| `npm run dev:log` | Dev + logging Electron |
| `npm run build:mac` | Build macOS |
| `npm run build:win` | Build Windows |
| `npm run rebuild` | Rebuild native modules |

## License

MIT
