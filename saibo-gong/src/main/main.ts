import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from 'electron';
import { join } from 'node:path';
import { throwPoe } from '../core/poe.ts';
import { Ledger } from '../core/ledger.ts';
import { Store } from '../core/store.ts';
import { isConfessionLength, pickConfession } from '../core/confession.ts';
import type { FeatureInfo, LedgerView, TempleState } from '../shared/api.ts';

const APP_NAME = '賽博宮';

// 資料夾名稱固定用英文，避免路徑編碼問題。SAIBO_DATA_DIR 只給開發測試用。
const dataDir = process.env.SAIBO_DATA_DIR || join(app.getPath('appData'), 'DigitalTemple');
const ledger = new Ledger(dataDir);
const store = new Store(dataDir);

const FEATURES: Omit<FeatureInfo, 'enabled'>[] = [
  { id: 'poePush', name: '擲筊 push', desc: 'git push 前先擲筊，三次為限', stage: 'M2', available: false },
  { id: 'almanac', name: '農民曆宜忌', desc: '忌開市之日不得正式上線', stage: 'M2', available: false },
  { id: 'fortune', name: '籤詩 code review', desc: '靜態檢查結果化為籤詩', stage: 'M3', available: false },
  { id: 'nameology', name: '變數姓名學', desc: '算識別字筆畫吉凶，只建議不擋', stage: 'M3', available: false },
  { id: 'underworld', name: '陰間回收筒', desc: '「燒給它」與請回陽間', stage: 'M4', available: false },
  { id: 'shoujing', name: '收驚', desc: '連續當機的程式幫它收驚', stage: 'M4', available: false },
  { id: 'pudu', name: '中元普渡', desc: '超渡沒有回應與殘留的程式', stage: 'M4', available: false },
  { id: 'guaiguai', name: '綠色乖乖', desc: '過期會不乖（效果皆可還原）', stage: 'M5', available: false },
];

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function buildState(): TempleState {
  const check = ledger.verify();
  const settings = store.getSettings();
  return {
    closed: settings.closed,
    tampered: !check.ok,
    tamperReason: check.reason,
    ledgerCount: check.entries.length,
    recentLedger: check.entries.slice(-5).reverse(),
    stats: store.getStats(),
    features: FEATURES.map((f) => ({ ...f, enabled: f.available && settings.features[f.id] !== false })),
    dataDir,
    confessionLength: isConfessionLength(settings.confessionLength) ? settings.confessionLength : 'medium',
    confessionHintShown: settings.confessionHintShown,
  };
}

function broadcast(): TempleState {
  const state = buildState();
  win?.webContents.send('state:changed', state);
  refreshTray(state);
  return state;
}

function closeTemple(): TempleState {
  // 閉廟是安全閥：不擲筊、不用懺悔文，永遠一鍵可用；但會記進功過簿。
  if (!store.getSettings().closed) {
    store.updateSettings({ closed: true });
    ledger.append({ feature: '主殿', action: '閉廟', target: '全部功能', confession: '' });
  }
  return broadcast();
}

function openTemple(): TempleState {
  store.updateSettings({ closed: false });
  return broadcast();
}

function showWindow(): void {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: '#1c0f0c',
    icon: join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(join(__dirname, 'renderer', 'index.html'));
  // 關視窗只是收進系統匣，廟還開著。
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on('closed', () => {
    win = null;
  });
}

function refreshTray(state: TempleState = buildState()): void {
  if (!tray) return;
  const status = state.tampered ? '功過簿遭竄改' : state.closed ? '閉廟中' : '開廟中';
  tray.setToolTip(`${APP_NAME}（${status}）`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `${APP_NAME}：${status}`, enabled: false },
      { type: 'separator' },
      { label: '進主殿', click: showWindow },
      state.closed ? { label: '開廟', click: () => openTemple() } : { label: '閉廟（暫停所有功能）', click: () => closeTemple() },
      { type: 'separator' },
      { label: '離開', click: () => { quitting = true; app.quit(); } },
    ]),
  );
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.on('click', showWindow);
  refreshTray();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName(APP_NAME);
  app.on('second-instance', showWindow);
  app.on('before-quit', () => {
    quitting = true;
  });
  // 常駐系統匣：所有視窗關掉也不結束。
  app.on('window-all-closed', () => {});

  app.whenReady().then(() => {
    ipcMain.handle('state:get', () => buildState());
    ipcMain.handle('poe:throw', () => {
      if (store.getSettings().closed) throw new Error('閉廟中，不能擲筊');
      const t = throwPoe();
      store.recordThrow(t.result);
      broadcast();
      return t;
    });
    ipcMain.handle('ledger:get', (): LedgerView => {
      const c = ledger.verify();
      return { ok: c.ok, reason: c.reason, brokenAt: c.brokenAt, entries: c.entries };
    });
    ipcMain.handle('temple:close', () => closeTemple());
    ipcMain.handle('temple:open', () => openTemple());
    ipcMain.handle('feature:set', (_e, id: string, enabled: boolean) => {
      const s = store.getSettings();
      if (FEATURES.some((f) => f.id === id && f.available)) {
        store.updateSettings({ features: { ...s.features, [id]: !!enabled } });
      }
      return broadcast();
    });
    ipcMain.handle('confession:pick', () => pickConfession(buildState().confessionLength));
    ipcMain.handle('confession:setLength', (_e, length: unknown) => {
      if (isConfessionLength(length)) store.updateSettings({ confessionLength: length });
      return broadcast();
    });
    ipcMain.handle('confession:hintShown', () => {
      store.updateSettings({ confessionHintShown: true });
      return broadcast();
    });

    createTray();
    createWindow();
  });
}
