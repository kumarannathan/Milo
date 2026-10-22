// Milo for macOS: the same server and web app, wrapped in a window.
// The server runs inside this process, bound to localhost on a random port, with the workspace
// stored in the app's own data folder. No accounts: the person at the keyboard is the user.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, shell, dialog, nativeTheme } from 'electron';
import { createApp } from '../server/app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(app.getPath('userData'), 'data');

let milo = null;
let win = null;

async function startServer() {
  process.env.MILO_PLAYBOOKS ??= 'sales';
  milo = await createApp({ dataDir, auth: 'none', staticDir: path.join(root, 'dist'), log: console });
  milo.start();
  await new Promise((resolve, reject) => {
    milo.server.once('error', reject);
    milo.server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${milo.server.address().port}`;
}

function createWindow(url) {
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
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  // Links to other sites open in the browser, not inside Milo.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(url)) shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, target) => {
    if (!target.startsWith(url)) {
      e.preventDefault();
      shell.openExternal(target);
    }
  });
  win.on('closed', () => (win = null));
  win.loadURL(url);
}

function buildMenu(url) {
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
        { label: 'Milo on GitHub', click: () => shell.openExternal('https://github.com/kumarannathan/Milo') },
        { label: 'Report a problem', click: () => shell.openExternal('https://github.com/kumarannathan/Milo/issues') },
        { type: 'separator' },
        { label: 'Open in browser', click: () => shell.openExternal(url) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  let url;
  try {
    url = await startServer();
  } catch (err) {
    dialog.showErrorBox('Milo could not start', String(err?.stack ?? err));
    app.quit();
    return;
  }
  buildMenu(url);
  createWindow(url);
  app.on('activate', () => {
    if (!win) createWindow(url);
  });
});

app.on('window-all-closed', () => {
  // Agents keep running while the app is open; closing the last window quits, like a document app would not.
  app.quit();
});

let closing = false;
app.on('before-quit', (e) => {
  if (closing || !milo) return;
  e.preventDefault();
  closing = true;
  Promise.race([milo.close(), new Promise((r) => setTimeout(r, 5000))]).finally(() => app.quit());
});
