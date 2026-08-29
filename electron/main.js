/* =====================================================================
   MTX Group Retail Suite — Electron desktop shell
   Serves the existing PWA from an internal 127.0.0.1 server so the app
   runs in a secure context: the service worker registers, IndexedDB is
   stable, and everything works exactly like the browser build — but in
   its own window, fully offline, no browser required.
   ===================================================================== */
const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..'); // app files live one level up
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

// Static file server — only serves files under ROOT (path-traversal safe).
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
        const filePath = path.join(ROOT, path.normalize(urlPath));
        if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
        fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
          res.end(data);
        });
      } catch (e) { res.writeHead(500); res.end('Error'); }
    });
    // Ephemeral port on loopback only — never exposed to the network.
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

let win;
async function createWindow() {
  const port = await startServer();
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1024, minHeight: 680,
    backgroundColor: '#1C1916',
    title: 'MTX Group Retail Suite',
    autoHideMenuBar: true,
    icon: path.join(ROOT, 'assets', 'icon-512.png'),
    webPreferences: {
      contextIsolation: true, nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  Menu.setApplicationMenu(null); // no browser-style menu bar
  // The page's own <title> (from the shared web build) would otherwise
  // override this window's title once it loads — keep it "MTX Group Retail Suite".
  win.on('page-title-updated', (e) => e.preventDefault());
  win.loadURL(`http://127.0.0.1:${port}/index.html`);

  // External links (if any) open in the real browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
}

/* ---------------- Auto-update ----------------
   Checks the GitHub repo (see package.json build.publish) for a newer
   release, downloads it in the background, then asks the user to restart.
   No-op in dev (`npm start` on an unpacked app) — only packaged installs
   check for updates. Requires internet access at check/download time;
   the app itself still works fully offline the rest of the time. */
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update ready',
      message: `MTX Group Retail Suite ${info.version} has been downloaded.`,
      detail: 'Restart now to install it, or install it next time you quit the app.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (err) => console.warn('Auto-update check failed:', err.message));
  autoUpdater.checkForUpdates().catch((err) => console.warn('Auto-update check failed:', err.message));
  // Re-check periodically in case the app is left open for a long time.
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

/* Print the current page straight to the default (or last-selected Windows)
   printer, with no dialog — used for receipts at checkout. */
ipcMain.handle('print-silent', () => new Promise((resolve) => {
  if (!win) return resolve({ success: false, reason: 'no window' });
  win.webContents.print({ silent: true, printBackground: true }, (success, reason) => {
    resolve({ success, reason });
  });
}));

// Single-instance: focus the existing window instead of opening a second.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => { await createWindow(); setupAutoUpdate(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
