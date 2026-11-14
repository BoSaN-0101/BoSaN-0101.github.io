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
  setConfessionLength: (length) => ipcRenderer.invoke('confession:setLength', length),
  markConfessionHintShown: () => ipcRenderer.invoke('confession:hintShown'),
  setProtectedBranches: (text) => ipcRenderer.invoke('push:setProtected', text),
  getHookStatus: () => ipcRenderer.invoke('hook:status'),
  chooseFolder: () => ipcRenderer.invoke('hook:chooseFolder'),
  installRepoHook: (dir) => ipcRenderer.invoke('hook:installRepo', dir),
  uninstallRepoHook: (dir) => ipcRenderer.invoke('hook:uninstallRepo', dir),
  installGlobalHook: () => ipcRenderer.invoke('hook:installGlobal'),
  uninstallGlobalHook: () => ipcRenderer.invoke('hook:uninstallGlobal'),
  chooseFiles: () => ipcRenderer.invoke('underworld:choose'),
  pullBurnRequests: () => ipcRenderer.invoke('underworld:pullBurn'),
  onBurnRequest: (cb) => {
    ipcRenderer.on('underworld:burnRequest', (_e, paths) => cb(paths));
  },
  burnFiles: (paths) => ipcRenderer.invoke('underworld:burn', paths),
  restoreSoul: (id, forced) => ipcRenderer.invoke('underworld:restore', id, forced),
  releaseSouls: (ids) => ipcRenderer.invoke('underworld:release', ids),
  getContextMenu: () => ipcRenderer.invoke('underworld:menuStatus'),
  setContextMenu: (on) => ipcRenderer.invoke('underworld:menuSet', on),
  checkCrashes: () => ipcRenderer.invoke('shoujing:check'),
  finishShoujing: (key) => ipcRenderer.invoke('shoujing:finish', key),
  restartProgram: (path) => ipcRenderer.invoke('shoujing:restart', path),
  findGhosts: () => ipcRenderer.invoke('pudu:find'),
  releaseGhosts: (pids) => ipcRenderer.invoke('pudu:release', pids),
  setPuduWhitelist: (text) => ipcRenderer.invoke('pudu:setWhitelist', text),
  dismissPuduReminder: () => ipcRenderer.invoke('pudu:dismissReminder'),
  readGuaiguai: (image) => ipcRenderer.invoke('guaiguai:read', image),
  registerGuaiguai: (expiry) => ipcRenderer.invoke('guaiguai:register', expiry),
  pacifyGuaiguai: () => ipcRenderer.invoke('guaiguai:pacify'),
  drawFortune: (dir) => ipcRenderer.invoke('fortune:draw', dir),
  getLastFortune: () => ipcRenderer.invoke('fortune:last'),
  setAutoFortune: (on) => ipcRenderer.invoke('fortune:setAuto', on),
  onFortune: (cb) => {
    ipcRenderer.on('fortune:ready', (_e, r) => cb(r));
  },
  pullRitual: () => ipcRenderer.invoke('ritual:pull'),
  finishRitual: (id, outcome) => ipcRenderer.invoke('ritual:finish', id, outcome),
  onRitualStart: (cb) => {
    ipcRenderer.on('ritual:start', (_e, r) => cb(r));
  },
  onRitualCancel: (cb) => {
    ipcRenderer.on('ritual:cancel', (_e, id) => cb(id));
  },
  onStateChanged: (cb) => {
    ipcRenderer.on('state:changed', (_e, s) => cb(s));
  },
};

contextBridge.exposeInMainWorld('temple', api);
