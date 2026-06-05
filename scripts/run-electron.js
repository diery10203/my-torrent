/**
 * Launcher — gỡ ELECTRON_RUN_AS_NODE trước khi spawn Electron.
 * Biến này (thường do IDE/CI set) khiến require('electron') trả về path string
 * thay vì API → app.on(...) crash ngay khi khởi động.
 */
const { spawn } = require('child_process');

delete process.env.ELECTRON_RUN_AS_NODE;

const electronPath = require('electron');
const args = process.argv.slice(2);

const child = spawn(electronPath, args.length ? args : ['.'], {
  stdio: 'inherit',
  env: process.env,
});

child.on('close', (code, signal) => {
  if (code !== null) process.exit(code);
  process.exit(signal ? 1 : 0);
});

child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});

function shutdownChild() {
  if (child.killed) return;
  child.kill('SIGTERM');
}

process.on('SIGTERM', shutdownChild);
process.on('SIGINT', shutdownChild);
