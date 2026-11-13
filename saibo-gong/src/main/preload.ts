import { contextBridge, ipcRenderer } from 'electron';
import type { TempleApi } from '../shared/api.ts';

const api: TempleApi = {
  getState: () => ipcRenderer.invoke('state:get'),
  throwPoe: () => ipcRenderer.invoke('poe:throw'),
  getLedger: () => ipcRenderer.invoke('ledger:get'),
  closeTemple: () => ipcRenderer.invoke('temple:close'),
  openTemple: () => ipcRenderer.invoke('temple:open'),
  setFeature: (id, enabled) => ipcRenderer.invoke('feature:set', id, enabled),
  pickConfession: () => ipcRenderer.invoke('confession:pick'),
  onStateChanged: (cb) => {
    ipcRenderer.on('state:changed', (_e, s) => cb(s));
  },
};

contextBridge.exposeInMainWorld('temple', api);
