const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const APP_NAME = 'Frakio Work';
const DEFAULT_PORT = 8787;
const HEALTH_TIMEOUT_MS = 45000;
const HEALTH_INTERVAL_MS = 500;
const desktopLaunchId = randomUUID();
const desktopLaunchStartedAt = Date.now();

let mainWindow = null;
let apiProcess = null;
let apiPort = DEFAULT_PORT;
let apiUrl = `http://127.0.0.1:${DEFAULT_PORT}`;
let quitting = false;
let startupError = '';
let startingPromise = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

const userHome = path.join(os.homedir(), '.frakio-work');
const logsDir = path.join(userHome, 'logs');
const desktopLogPath = path.join(logsDir, 'desktop.log');
const apiLogPath = path.join(logsDir, 'api.log');

function ensureLogsDir() {
  fs.mkdirSync(logsDir, { recursive: true });
}

function writeDesktopLog(message) {
  try {
    ensureLogsDir();
    fs.appendFileSync(desktopLogPath, `[${new Date().toISOString()}] ${message}\n`);
  } catch {}
}

function appendApiLog(chunk) {
  try {
    ensureLogsDir();
    fs.appendFileSync(apiLogPath, chunk);
  } catch {}
}

function appRoot() {
  if (!app.isPackaged) return path.resolve(__dirname, '../..');
  return path.join(process.resourcesPath, 'app.asar.unpacked');
}

function resourcePath(...parts) {
  return path.join(appRoot(), ...parts);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findPort(preferred) {
  for (let offset = 0; offset < 20; offset += 1) {
    const candidate = preferred + offset;
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error('No free local port found for Frakio Work.');
}

function requestHealth(url) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/health`, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.once('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForHealth(url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    if (await requestHealth(url)) return true;
    await wait(HEALTH_INTERVAL_MS);
  }
  return false;
}

function electronNodeExecutable() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, '..', 'MacOS', APP_NAME);
  }
  return path.resolve(process.execPath);
}

function serverEntry() {
  return resourcePath('apps/api/server.mjs');
}

function uniquePathEntries(entries) {
  const seen = new Set();
  return entries
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .filter((entry) => {
      if (seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
}

function runtimePath() {
  return uniquePathEntries([
    path.join(appRoot(), 'node_modules', '.bin'),
    path.dirname(process.execPath),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.npm-global', 'bin'),
    ...String(process.env.PATH || '').split(path.delimiter),
  ]).join(path.delimiter);
}

async function startApi() {
  if (apiProcess && !apiProcess.killed) return apiUrl;
  if (startingPromise) return startingPromise;

  startingPromise = (async () => {
    startupError = '';
    apiPort = await findPort(DEFAULT_PORT);
    apiUrl = `http://127.0.0.1:${apiPort}`;

    const root = appRoot();
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      FRAKIO_WORK_DESKTOP: '1',
      FRAKIO_WORK_PACKAGED: app.isPackaged ? '1' : '0',
      FRAKIO_WORK_LAUNCH_ID: desktopLaunchId,
      FRAKIO_WORK_LAUNCH_STARTED_AT: String(desktopLaunchStartedAt),
      FRAKIO_WORK_APP_VERSION: app.getVersion(),
      FRAKIO_WORK_PLATFORM: process.platform === 'darwin' ? 'macos' : process.platform,
      FRAKIO_WORK_ARCH: process.arch,
      FRAKIO_WORK_BUILD_CHANNEL: app.isPackaged ? 'production' : 'development',
      FRAKIO_WORK_HOME: userHome,
      FRAKIO_WORK_APP_ROOT: root,
      FRAKIO_WORK_WEB_DIST: resourcePath('dist'),
      PATH: runtimePath(),
      PORT: String(apiPort),
    };

    writeDesktopLog(`Starting API on ${apiUrl}`);
    apiProcess = spawn(electronNodeExecutable(), [serverEntry()], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    apiProcess.stdout.on('data', (chunk) => appendApiLog(chunk));
    apiProcess.stderr.on('data', (chunk) => appendApiLog(chunk));
    apiProcess.once('spawn', () => {
      writeDesktopLog(`API child spawned pid=${apiProcess.pid || ''} entry=${serverEntry()}`);
    });
    apiProcess.once('error', (error) => {
      startupError = error?.message || String(error);
      writeDesktopLog(`API spawn error: ${startupError}`);
    });
    apiProcess.once('exit', (code, signal) => {
      writeDesktopLog(`API exited code=${code ?? ''} signal=${signal ?? ''}`);
      apiProcess = null;
      if (!quitting) {
        startupError = 'Frakio Work 本地服务已退出。';
        showErrorPage();
      }
    });

    const healthy = await waitForHealth(apiUrl);
    if (!healthy) {
      startupError = 'Frakio Work 本地服务启动超时。';
      writeDesktopLog(startupError);
      throw new Error(startupError);
    }
    writeDesktopLog(`API ready at ${apiUrl}`);
    return apiUrl;
  })().finally(() => {
    startingPromise = null;
  });

  return startingPromise;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 520,
    minHeight: 680,
    title: APP_NAME,
    show: false,
    backgroundColor: '#f7faf8',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedReleaseUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(apiUrl) || url.startsWith('data:text/html')) return;
    event.preventDefault();
    if (isAllowedReleaseUrl(url)) shell.openExternal(url);
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function loadApp() {
  if (!mainWindow) createWindow();
  try {
    const url = await startApi();
    await mainWindow.loadURL(url);
  } catch (error) {
    startupError = error?.message || String(error);
    writeDesktopLog(`Load failed: ${startupError}`);
    showErrorPage();
  }
}

function showErrorPage() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const cleanError = String(startupError || 'Frakio Work 本地服务暂时不可用。')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>Frakio Work</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7faf8; color: #1f2825; }
    main { width: min(520px, calc(100vw - 48px)); display: grid; gap: 18px; }
    h1 { margin: 0; font-size: 24px; }
    p { margin: 0; color: #66736f; line-height: 1.6; }
    code { color: #9a3412; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
    button { height: 36px; padding: 0 14px; border-radius: 7px; border: 1px solid #cfd9d5; background: white; color: #173c35; font: inherit; cursor: pointer; }
    button.primary { background: #173c35; color: white; border-color: #173c35; }
  </style>
</head>
<body>
  <main>
    <h1>Frakio Work 本地服务没有启动</h1>
    <p>${cleanError}</p>
    <p>可以重试启动，或者打开日志目录查看 <code>desktop.log</code> 和 <code>api.log</code>。</p>
    <div class="actions">
      <button class="primary" onclick="window.frakioDesktop.restartService()">重试启动</button>
      <button onclick="window.frakioDesktop.openLogs()">打开日志目录</button>
    </div>
  </main>
</body>
</html>`)}`);
}

async function stopApi() {
  if (!apiProcess) return;
  const processToStop = apiProcess;
  apiProcess = null;
  writeDesktopLog('Stopping API');
  const exited = new Promise((resolve) => processToStop.once('exit', resolve));
  processToStop.kill('SIGTERM');
  await Promise.race([exited, wait(3500)]);
  if (processToStop.exitCode === null) {
    try {
      processToStop.kill('SIGKILL');
    } catch {}
    await Promise.race([exited, wait(1000)]);
  }
  writeDesktopLog(`API stopped exitCode=${processToStop.exitCode ?? 'unknown'} signal=${processToStop.signalCode || 'none'}`);
}

async function restartApiAndReload() {
  await stopApi();
  await loadApp();
}

function openLogsDir() {
  ensureLogsDir();
  shell.openPath(logsDir);
}

function setLoginStartup(enabled) {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    openAsHidden: false,
    name: APP_NAME,
  });
}

function loginStartupEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

function buildMenu() {
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { label: '关于 Frakio Work', role: 'about' },
        { type: 'separator' },
        {
          label: '开机自动启动',
          type: 'checkbox',
          checked: loginStartupEnabled(),
          click: (item) => setLoginStartup(item.checked),
        },
        { type: 'separator' },
        { label: '退出', accelerator: 'Cmd+Q', click: () => app.quit() },
      ],
    },
    {
      label: '服务',
      submenu: [
        { label: '打开 Frakio Work', click: () => loadApp() },
        { label: '重启本地服务', click: () => restartApiAndReload() },
        { label: '打开日志目录', click: () => openLogsDir() },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'reload', label: '重新载入窗口' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('frakio:restart-service', async () => {
  await restartApiAndReload();
  return { ok: true };
});

ipcMain.handle('frakio:open-logs', async () => {
  openLogsDir();
  return { ok: true };
});

ipcMain.handle('frakio:get-login-startup', () => ({ enabled: loginStartupEnabled() }));

ipcMain.handle('frakio:set-login-startup', (_event, enabled) => {
  setLoginStartup(Boolean(enabled));
  buildMenu();
  return { enabled: loginStartupEnabled() };
});

ipcMain.handle('frakio:select-folder', async (_event) => {
  const target = BrowserWindow.fromWebContents(_event.sender) || mainWindow;
  const result = await dialog.showOpenDialog(target, {
    title: '选择文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  return {
    canceled: Boolean(result.canceled),
    path: result.filePaths?.[0] || '',
  };
});

ipcMain.handle('frakio:window-control', (_event, action) => {
  const target = BrowserWindow.fromWebContents(_event.sender);
  if (!target || target.isDestroyed()) return { ok: false };
  if (action === 'close') target.close();
  if (action === 'minimize') target.minimize();
  if (action === 'zoom') {
    if (target.isMaximized()) target.unmaximize();
    else target.maximize();
  }
  return { ok: true };
});

ipcMain.handle('frakio:show-item-in-folder', async (_event, targetPath) => {
  const cleanPath = String(targetPath || '').trim();
  const relative = path.relative(os.homedir(), path.resolve(cleanPath || '.'));
  if (!cleanPath || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(cleanPath)) return { ok: false };
  shell.showItemInFolder(cleanPath);
  return { ok: true };
});

function isAllowedReleaseUrl(targetUrl) {
  try {
    const url = new URL(String(targetUrl || ''));
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith('/MadsGao/frakio-work/releases/');
  } catch {
    return false;
  }
}

ipcMain.handle('frakio:open-release', async (_event, targetUrl) => {
  if (!isAllowedReleaseUrl(targetUrl)) return { ok: false };
  await shell.openExternal(String(targetUrl));
  return { ok: true };
});

app.on('second-instance', () => {
  if (!mainWindow) {
    loadApp();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) loadApp();
});

app.whenReady().then(async () => {
  ensureLogsDir();
  buildMenu();
  await loadApp();
}).catch((error) => {
  dialog.showErrorBox(APP_NAME, error?.message || String(error));
});

app.on('will-quit', async (event) => {
  if (apiProcess) {
    event.preventDefault();
    await stopApi();
    app.exit(0);
  }
});
