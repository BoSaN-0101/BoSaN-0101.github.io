import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron';
import { join } from 'node:path';
import { throwPoe } from '../core/poe.ts';
import { Ledger } from '../core/ledger.ts';
import { Store } from '../core/store.ts';
import { getConfession, isConfessionComplete, isConfessionLength, pickConfession } from '../core/confession.ts';
import { getAlmanac, parseDate } from '../core/almanac.ts';
import { dataDir as resolveDataDir } from '../core/paths.ts';
import { DEFAULT_PROTECTED, describeRefs, parseBranchList, releaseTargets, repoName, type PushInfo } from '../core/push.ts';
import * as hooks from '../core/hooks.ts';
import { HookServer, type Decision, type PendingPush } from './hook-server.ts';
import type { ActionResult, Defiance, FeatureInfo, HookStatus, LedgerView, RitualOutcome, RitualRequest, TempleState } from '../shared/api.ts';

const APP_NAME = '賽博宮';
const MAX_THROWS = 3;

const dataDir = resolveDataDir();
const ledger = new Ledger(dataDir);
const store = new Store(dataDir);
const hookPaths: hooks.HookPaths = { exe: process.execPath, cli: join(__dirname, 'hook-client.js') };

const FEATURES: Omit<FeatureInfo, 'enabled'>[] = [
  { id: 'poePush', name: '擲筊 push', desc: 'git push 前先擲筊，三次為限', stage: 'M2', available: true },
  { id: 'almanac', name: '農民曆宜忌', desc: '忌開市之日不得正式上線', stage: 'M2', available: true },
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

/** 今天。SAIBO_FAKE_DATE=YYYY-MM-DD 只給開發測試用（例如模擬忌開市的日子）。 */
function today(): Date {
  return (process.env.SAIBO_FAKE_DATE && parseDate(process.env.SAIBO_FAKE_DATE)) || new Date();
}

const featureOn = (id: string) => store.getSettings().features[id] !== false;
const protectedBranches = () => {
  const list = store.getSettings().protectedBranches;
  return Array.isArray(list) && list.length ? list : DEFAULT_PROTECTED;
};

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
    almanac: getAlmanac(today()),
    protectedBranches: protectedBranches(),
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
    // 正在等的 push 一律放行。
    if (hookServer.active) win?.webContents.send('ritual:cancel', hookServer.active.id);
    hookServer.releaseAll('閉廟中，這次放行。');
  }
  return broadcast();
}

function openTemple(): TempleState {
  store.updateSettings({ closed: false });
  return broadcast();
}

// ───────── push 儀式 ─────────

function almanacBlock(info: PushInfo): string | null {
  if (!featureOn('almanac')) return null;
  const targets = releaseTargets(info.refs, protectedBranches());
  if (targets.length === 0) return null;
  const a = getAlmanac(today());
  if (!a.jiKaishi) return null;
  return `今日忌${a.ji.includes('開市') ? '開市' : '諸事'}，不宜正式上線（${targets.join('、')}）`;
}

function toRitual(p: PendingPush): RitualRequest {
  return {
    id: p.id,
    repo: repoName(p.info.repoPath),
    refs: describeRefs(p.info.refs),
    almanacBlock: almanacBlock(p.info),
    poe: featureOn('poePush'),
    maxThrows: MAX_THROWS,
  };
}

const hookServer = new HookServer({
  dataDir,
  quickDecision(info): Decision | null {
    if (store.getSettings().closed) return { allow: true, message: '' };
    if (!featureOn('poePush') && !almanacBlock(info)) return { allow: true, message: '' };
    return null;
  },
  onStart(p) {
    showWindow();
    win?.setAlwaysOnTop(true);
    win?.setAlwaysOnTop(false);
    win?.flashFrame(true);
    if (win && !win.webContents.isLoading()) win.webContents.send('ritual:start', toRitual(p));
  },
  onVanish(p) {
    win?.webContents.send('ritual:cancel', p.id);
  },
});

function validDefiance(d: Defiance | undefined): d is Defiance {
  return !!d && isConfessionComplete(d.confessionId, d.typed);
}

function finishRitual(id: string, outcome: RitualOutcome): void {
  const p = hookServer.active;
  if (!p || p.id !== id) return;
  const req = toRitual(p);
  const target = `${req.repo}：${req.refs}`;
  let defied = false;
  // 懺悔文由主程序再核對一次，沒打對就不算數。
  if (req.almanacBlock && outcome.almanacDefied) {
    if (!validDefiance(outcome.almanacDefied)) outcome.allow = false;
    else {
      ledger.append({ feature: '農民曆宜忌', action: '硬闖', target: `${target}（${req.almanacBlock}）`, confession: getConfession(outcome.almanacDefied.confessionId)!.text });
      defied = true;
    }
  } else if (req.almanacBlock) outcome.allow = false;
  if (outcome.allow && req.poe && !outcome.blessed) {
    if (!validDefiance(outcome.poeDefied)) outcome.allow = false;
    else {
      ledger.append({ feature: '擲筊 push', action: '硬闖', target, confession: getConfession(outcome.poeDefied.confessionId)!.text });
      defied = true;
    }
  }
  store.recordPush(!outcome.allow ? 'pushAbandoned' : defied ? 'pushDefied' : 'pushBlessed');
  win?.flashFrame(false);
  hookServer.resolve(id, {
    allow: outcome.allow,
    message: !outcome.allow ? '神明不准，push 取消。' : defied ? '硬闖放行，已記入功過簿。' : '神明准了，放行。',
  });
  broadcast();
}

// ───────── git hook 安裝 ─────────

function hookStatus(): HookStatus {
  const gitAvailable = hooks.gitAvailable();
  const repos = store.getSettings().hookRepos ?? [];
  return {
    gitAvailable,
    global: gitAvailable && hooks.isGlobalInstalled(dataDir),
    repos: repos.map((path) => ({ path, installed: gitAvailable && hooks.isRepoInstalled(path) })),
  };
}

function installRepo(dir: string): ActionResult {
  const r = hooks.installRepoHook(dir, hookPaths, dataDir);
  if (r.ok && r.root) {
    const repos = store.getSettings().hookRepos ?? [];
    if (!repos.includes(r.root)) store.updateSettings({ hookRepos: [...repos, r.root] });
  }
  return { ok: r.ok, message: r.message };
}

function uninstallRepo(dir: string): ActionResult {
  const r = hooks.uninstallRepoHook(dir);
  store.updateSettings({ hookRepos: (store.getSettings().hookRepos ?? []).filter((p) => p !== dir) });
  return r;
}

// ───────── 視窗與系統匣 ─────────

function showWindow(): void {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1120,
    height: 820,
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
    // 離開前把等著的 push 放行，不留人卡在終端機。
    hookServer.releaseAll('主殿關門了，這次放行。');
    hookServer.stop();
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
    ipcMain.handle('push:setProtected', (_e, text: string) => {
      const list = parseBranchList(String(text ?? ''));
      store.updateSettings({ protectedBranches: list.length ? list : DEFAULT_PROTECTED });
      return broadcast();
    });

    ipcMain.handle('hook:status', () => hookStatus());
    ipcMain.handle('hook:chooseFolder', async () => {
      const r = win
        ? await dialog.showOpenDialog(win, { title: '選擇要安裝擲筊 push 的 repo 資料夾', properties: ['openDirectory'] })
        : { canceled: true, filePaths: [] as string[] };
      return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
    });
    ipcMain.handle('hook:installRepo', (_e, dir: string) => installRepo(String(dir)));
    ipcMain.handle('hook:uninstallRepo', (_e, dir: string) => uninstallRepo(String(dir)));
    ipcMain.handle('hook:installGlobal', () => hooks.installGlobalHook(hookPaths, dataDir));
    ipcMain.handle('hook:uninstallGlobal', () => hooks.uninstallGlobalHook(dataDir));

    ipcMain.handle('ritual:pull', () => (hookServer.active ? toRitual(hookServer.active) : null));
    ipcMain.handle('ritual:finish', (_e, id: string, outcome: RitualOutcome) => finishRitual(String(id), { ...outcome }));

    hookServer.start();
    createTray();
    createWindow();
  });
}
