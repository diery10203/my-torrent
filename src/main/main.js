/**
 * main.js — Cửa sổ Liquid Glassmorphism (Electron Main Process)
 *
 * Yêu cầu đã đáp ứng:
 * - transparent: true, frame: false, resizable: true, hasShadow: true
 * - macOS: vibrancy 'under-window', visualEffectState 'active'
 * - Windows 11+: backgroundMaterial 'mica' (fallback 'acrylic') — API native Electron
 * - preload.js + contextIsolation: true, nodeIntegration: false, sandbox: true
 *
 * Entry ứng dụng: package.json → "main": "src/main/index.js"
 * index.js gọi createMainWindow() từ file này.
 *
 * Renderer: src/index.html + style.css (backdrop-filter).
 * Không cần electron-vibrancy (không tương thích Electron 35).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app, BrowserWindow, nativeTheme } = require('electron');

const APP_ICON = path.join(__dirname, '../../assets/icon.png');
const RENDERER_HTML = path.join(__dirname, '../index.html');

/** Cầu nối IPC bảo mật — Renderer không có quyền Node */
const PRELOAD_SCRIPT = path.join(__dirname, '../preload/preload.js');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const glassSupported = isMac || isWin;

/** @type {const} */
const GLASS_CONFIG = {
  macVibrancy: 'under-window',
  /** Giữ độ mờ khi cửa sổ mất focus (click ra ngoài app) */
  macVisualEffectState: 'active',
  winMaterial: 'mica',
  winMaterialFallback: 'acrylic',
};

/** Windows 11 = build >= 22000 */
const WIN11_MIN_BUILD = 22000;

/**
 * @returns {number | null} NT build number trên Windows
 */
function getWindowsBuild() {
  if (!isWin) return null;
  const parts = os.release().split('.');
  const build = parseInt(parts[2], 10);
  return Number.isFinite(build) ? build : null;
}

/**
 * Ghi log / cảnh báo nền tảng (Mica chỉ Windows 11+).
 */
function logGlassPlatformHints() {
  if (isMac) {
    console.info(
      '[My Torrent] macOS Vibrancy:',
      GLASS_CONFIG.macVibrancy,
      '| visualEffectState:',
      GLASS_CONFIG.macVisualEffectState
    );
    return;
  }

  if (isWin) {
    const build = getWindowsBuild();
    if (build !== null && build < WIN11_MIN_BUILD) {
      console.warn(
        '[My Torrent] Windows build',
        build,
        '— Mica có thể không khả dụng. Đang dùng fallback acrylic hoặc chỉ CSS glass.\n' +
          '  Khuyến nghị: Windows 11 (build ≥ 22000). Không cần cài thêm package;\n' +
          '  Electron native: win.setBackgroundMaterial("mica" | "acrylic").'
      );
    } else {
      console.info(
        '[My Torrent] Windows backgroundMaterial:',
        GLASS_CONFIG.winMaterial,
        '(fallback:',
        GLASS_CONFIG.winMaterialFallback + ')'
      );
    }
    return;
  }

  console.info(
    '[My Torrent] Linux: không hỗ trợ Vibrancy/Mica — cửa sổ opaque + khung hệ thống.'
  );
}

/**
 * @returns {import('electron').BrowserWindowConstructorOptions}
 */
function getGlassWindowOptions() {
  if (!fs.existsSync(PRELOAD_SCRIPT)) {
    throw new Error(`Preload không tồn tại: ${PRELOAD_SCRIPT}`);
  }

  const webPreferences = {
    preload: PRELOAD_SCRIPT,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };

  const common = {
    width: 1200,
    height: 720,
    minWidth: 900,
    minHeight: 500,
    title: 'My Torrent',
    icon: APP_ICON,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: true,
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    webPreferences,
  };

  if (isMac) {
    return {
      ...common,
      vibrancy: GLASS_CONFIG.macVibrancy,
      visualEffectState: GLASS_CONFIG.macVisualEffectState,
    };
  }

  if (isWin) {
    const build = getWindowsBuild();
    const useMica = build === null || build >= WIN11_MIN_BUILD;

    return {
      ...common,
      backgroundMaterial: useMica ? GLASS_CONFIG.winMaterial : GLASS_CONFIG.winMaterialFallback,
      thickFrame: true,
      roundedCorners: true,
    };
  }

  return {
    ...common,
    transparent: false,
    frame: true,
    titleBarStyle: 'default',
    backgroundColor: '#1a1b1e',
  };
}

/**
 * @param {import('electron').BrowserWindow} win
 */
function applyGlassEffects(win) {
  if (!glassSupported || win.isDestroyed()) return;

  if (isMac) {
    win.setVibrancy(GLASS_CONFIG.macVibrancy, {
      visualEffectState: GLASS_CONFIG.macVisualEffectState,
    });
    return;
  }

  if (isWin) {
    const build = getWindowsBuild();
    const material =
      build !== null && build < WIN11_MIN_BUILD
        ? GLASS_CONFIG.winMaterialFallback
        : GLASS_CONFIG.winMaterial;

    try {
      win.setBackgroundMaterial(material);
    } catch (err) {
      console.warn(
        '[My Torrent] setBackgroundMaterial thất bại:',
        err.message,
        '— dùng CSS liquid-glass trong renderer.'
      );
      try {
        win.setBackgroundMaterial(GLASS_CONFIG.winMaterialFallback);
      } catch {
        /* Windows cũ hoặc DWM tắt hiệu ứng */
      }
    }
  }
}

/**
 * Chỉ dùng nút custom trong HTML — ẩn traffic lights gốc macOS (tránh 2 cụm nút).
 * @param {import('electron').BrowserWindow} win
 */
function hideNativeWindowControls(win) {
  if (!isMac || win.isDestroyed()) return;
  if (typeof win.setWindowButtonVisibility === 'function') {
    win.setWindowButtonVisibility(false);
  }
}

/**
 * Duy trì hiệu ứng khi blur / đổi theme hệ thống.
 * @param {import('electron').BrowserWindow} win
 */
function maintainGlassOnBlur(win) {
  if (!glassSupported) return;

  const reapply = () => {
    applyGlassEffects(win);
    hideNativeWindowControls(win);
  };

  win.on('blur', reapply);
  win.on('focus', reapply);
  win.on('show', reapply);
  win.on('restore', reapply);
  win.on('unmaximize', reapply);

  nativeTheme.on('updated', reapply);
}

/**
 * Tạo cửa sổ chính — Liquid Glass (Vibrancy / Mica).
 * @returns {import('electron').BrowserWindow}
 */
function createMainWindow() {
  logGlassPlatformHints();

  const win = new BrowserWindow(getGlassWindowOptions());

  hideNativeWindowControls(win);
  maintainGlassOnBlur(win);

  win.webContents.on('did-finish-load', () => {
    win.webContents
      .executeJavaScript(
        `document.documentElement.classList.toggle('glass-window', ${glassSupported});` +
          `document.documentElement.classList.add('platform-${process.platform}');`,
        true
      )
      .catch(() => {});
  });

  win.loadFile(RENDERER_HTML);

  win.once('ready-to-show', () => {
    applyGlassEffects(win);
    hideNativeWindowControls(win);
    win.show();
  });

  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  return win;
}

/**
 * Đăng ký app làm handler mặc định cho magnet: — chỉ khi đã build/đóng gói.
 * Dev (npm start) bỏ qua để Electron dev không chiếm quyền mở link trên hệ thống.
 */
function registerPackagedProtocolHandlers() {
  if (!app.isPackaged) {
    console.info('[My Torrent] Dev mode — bỏ qua đăng ký magnet:// handler');
    return;
  }

  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('magnet', process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient('magnet');
  }
}

module.exports = {
  createMainWindow,
  registerPackagedProtocolHandlers,
  applyGlassEffects,
  maintainGlassOnBlur,
  getGlassWindowOptions,
  isGlassSupported: glassSupported,
  PRELOAD_SCRIPT,
  GLASS_CONFIG,
};
