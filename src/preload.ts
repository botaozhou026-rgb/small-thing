import { contextBridge, ipcRenderer } from 'electron';
import type { ReaderAPI } from './shared';

const api: ReaderAPI = {
  initialize: () => ipcRenderer.invoke('reader:initialize'),
  open: () => ipcRenderer.invoke('reader:open'),
  save: (state) => ipcRenderer.invoke('reader:save', state),
  onClose: (callback) => { ipcRenderer.on('reader:prepare-close', () => callback()); },
  closeReady: () => ipcRenderer.send('reader:close-ready'),
};
contextBridge.exposeInMainWorld('reader', api);
