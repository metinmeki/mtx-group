/* =====================================================================
   MTX Group Retail Suite — preload script
   Exposes a minimal, safe bridge so the web app can ask the main process
   to print silently (no OS print dialog) instead of calling window.print().
   contextIsolation stays on — nothing else from Node/Electron is exposed.
   ===================================================================== */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronPrint', {
  silent: () => ipcRenderer.invoke('print-silent')
});
