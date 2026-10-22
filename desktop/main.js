// Milo for macOS: the same server and web app, wrapped in a window.
// The server runs inside this process, bound to localhost on a random port, with the workspace
// stored in the app's own data folder. No accounts: the person at the keyboard is the user.
// A per-launch secret (sent as Basic auth by this window only) keeps other local processes and
// web pages out of the API.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, shell, dialog, nativeTheme, session } from 'electron';
import { createApp } from '../server/app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(app.getPath('userData'), 'data');
const secret = randomBytes(24).toString('base64url');

let milo = null;
let win = null;
let origin = '';

async function startServer() {
  process.env.MILO_PLAYBOOKS ??= 'sales';
  milo = await createApp({ dataDir, auth: 'none', password: secret, staticDir: path.join(root, 'dist'), log: console });
  milo.start();
  await new Promise((resolve, reject) => {
    milo.server.once('error', reject);
    milo.server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${milo.server.address().port}`;
  // Only requests this app makes to its own server carry the secret.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    details.requestHeaders.Authorization = `Basic ${Buffer.from(`milo:${secret}`).toString('base64')}`;
    callback({ requestHeaders: details.requestHeaders });
  });
  return origin;
}

function sameOrigin(target) {
  try {
    return new URL(target).origin === origin;
  } catch {
    return false;
  }
}

// Outside links open in the browser. Only web and mail links; nothing that could launch another app.
function openOutside(target) {
  try {
    const u = new URL(target);
    if (['https:', 'http:', 'mailto:'].includes(u.protocol)) shell.openExternal(u.href);
  } catch {}
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1200,
    minHeight: 720,
    title: 'Milo',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111110' : '#f6f6f3',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!sameOrigin(target)) openOutside(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, target) => {
    if (!sameOrigin(target)) {
      e.preventDefault();
      openOutside(target);
    }
  });
  win.on('closed', () => (win = null));
  win.loadURL(origin);
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Open data folder', click: () => shell.showItemInFolder(path.join(dataDir, 'milo.json')) },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win?.reload() },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Milo on GitHub', click: () => openOutside('https://github.com/kumarannathan/Milo') },
        { label: 'Report a problem', click: () => openOutside('https://github.com/kumarannathan/Milo/issues') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  try {
    await startServer();
  } catch (err) {
    dialog.showErrorBox('Milo could not start', String(err?.stack ?? err));
    app.quit();
    return;
  }
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (!win) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

let closing = false;
app.on('before-quit', (e) => {
  if (closing || !milo) return;
  e.preventDefault();
  closing = true;
  Promise.race([milo.close(), new Promise((r) => setTimeout(r, 5000))]).finally(() => app.quit());
});
