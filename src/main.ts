import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import path from 'node:path';
import { ReaderSession } from './reader';

// Test runs isolate all Electron and reading data in a temporary directory.
if (process.env.ZREAD_TEST_DATA) app.setPath('userData', process.env.ZREAD_TEST_DATA);
let window: BrowserWindow;
let session: ReaderSession;
let mayClose = false;
let closing = false;

app.whenReady().then(() => {
  session = new ReaderSession(path.join(app.getPath('userData'), 'reading-state.json'));
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    width: 1100, height: 800, minWidth: 620, minHeight: 440,
    title: 'ZRead', backgroundColor: '#faf9f6',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true },
  });
  const trusted = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) =>
    event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  ipcMain.handle('reader:initialize', (event) => {
    if (!trusted(event)) throw new Error('Unknown sender');
    const state = session.state;
    if (!state.file) return { state, result: {}, warning: session.warning };
    try { return { state, result: { book: session.open(state.file) }, warning: session.warning }; }
    catch (error) { return { state, result: { error: `无法恢复上次阅读：${(error as Error).message}` } }; }
  });
  ipcMain.handle('reader:open', async (event) => {
    if (!trusted(event)) throw new Error('Unknown sender');
    const result = await dialog.showOpenDialog(window, {
      title: '打开 TXT 文件', properties: ['openFile'], filters: [{ name: 'TXT 文本', extensions: ['txt'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    try { return { book: session.open(result.filePaths[0]) }; }
    catch (error) { return { error: (error as Error).message }; }
  });
  ipcMain.handle('reader:save', (event, state: unknown) => {
    if (!trusted(event)) throw new Error('Unknown sender');
    try { session.save(state); return {}; }
    catch { return { error: '阅读进度暂时无法保存，请检查本地存储空间和权限。' }; }
  });
  ipcMain.on('reader:close-ready', (event) => {
    if (trusted(event) && closing) { mayClose = true; window.close(); }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('close', (event) => {
    if (mayClose) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    window.webContents.send('reader:prepare-close');
    const fallback = setTimeout(() => { if (!window.isDestroyed()) window.destroy(); }, 2500);
    fallback.unref();
  });
  const devURL = process.env.ZREAD_DEV_URL;
  if (devURL && !app.isPackaged) void window.loadURL(devURL);
  else void window.loadFile(path.join(__dirname, '../dist/index.html'));
});
app.on('window-all-closed', () => app.quit());
