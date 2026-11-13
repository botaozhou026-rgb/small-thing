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
  app.setAppUserModelId('local.zread.reader');
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
    if (!state.file) return { state, result: {}, history: session.history, warning: session.warning };
    try {
      const book = session.open(state.file);
      return { state, result: { book }, history: session.history, warning: session.warning };
    }
    catch (error) { return { state, history: session.history, result: { error: `无法恢复上次阅读：${(error as Error).message}` } }; }
  });
  ipcMain.handle('reader:open', async (event) => {
    if (!trusted(event)) throw new Error('Unknown sender');
    const result = await dialog.showOpenDialog(window, {
      title: '打开 TXT 文件', properties: ['openFile'], filters: [{ name: 'TXT 文本', extensions: ['txt'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    try {
      const book = session.open(result.filePaths[0]);
      return { book, anchor: session.state.anchor, history: session.history };
    }
    catch (error) { return { error: (error as Error).message }; }
  });
  ipcMain.handle('reader:open-recent', (event, file: unknown) => {
    if (!trusted(event)) throw new Error('Unknown sender');
    if (typeof file !== 'string' || !session.history.some((entry) => entry.file === file)) {
      return { error: '阅读记录不存在，请重新选择文件。' };
    }
    try {
      const book = session.open(file);
      return { book, anchor: session.state.anchor, history: session.history };
    } catch (error) { return { error: (error as Error).message }; }
  });
  ipcMain.handle('reader:remove-recent', (event, file: unknown) => {
    if (!trusted(event)) throw new Error('Unknown sender');
    if (typeof file !== 'string') return { error: '无效的阅读记录。' };
    try { session.remove(file); return { history: session.history }; }
    catch { return { error: '无法删除阅读记录，请检查本地存储权限。' }; }
  });
  ipcMain.handle('reader:save', (event, state: unknown) => {
    if (!trusted(event)) throw new Error('Unknown sender');
    try { session.save(state); return { history: session.history }; }
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
