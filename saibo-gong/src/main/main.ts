import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, session, shell, Tray } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { throwPoe } from '../core/poe.ts';
import { Ledger } from '../core/ledger.ts';
import { Store } from '../core/store.ts';
import { getConfession, isConfessionComplete, isConfessionLength, pickConfession } from '../core/confession.ts';
import { getAlmanac, parseDate } from '../core/almanac.ts';
import { dataDir as resolveDataDir } from '../core/paths.ts';
import { DEFAULT_PROTECTED, describeRefs, parseBranchList, releaseTargets, repoName, type PushInfo } from '../core/push.ts';
import * as hooks from '../core/hooks.ts';
import { drawFortune, loadStrokeTable, type FortuneReport } from '../core/fortune.ts';
import { HookServer, type Decision, type PendingPush } from './hook-server.ts';
import { Underworld } from '../core/underworld.ts';
import { findScared, SCARE_WINDOW_MS, type Scared } from '../core/shoujing.ts';
import { findGhosts, parseWhitelist, type Ghost } from '../core/pudu.ts';
import * as sys from './system.ts';
import { Effects } from './effects.ts';
import { guaiguaiStatus, isValidDate, parseExpiry } from '../core/guaiguai.ts';
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
  { id: 'fortune', name: '籤詩 code review', desc: '靜態檢查結果化為籤詩', stage: 'M3', available: true },
  { id: 'nameology', name: '變數姓名學', desc: '抽籤時算新名字的筆畫吉凶，只建議不擋', stage: 'M3', available: true },
  { id: 'underworld', name: '陰間回收筒', desc: '「燒給它」與請回陽間', stage: 'M4', available: true },
  { id: 'shoujing', name: '收驚', desc: '連續當機的程式幫它收驚', stage: 'M4', available: true },
  { id: 'pudu', name: '中元普渡', desc: '超渡沒有回應與殘留的程式', stage: 'M4', available: true },
  { id: 'guaiguai', name: '綠色乖乖', desc: '過期會不乖（效果皆可還原）', stage: 'M5', available: true },
];

const underworld = new Underworld({
  dir: join(dataDir, 'underworld'),
  fallbackDir: join(app.getPath('desktop'), '賽博宮還陽'),
  protectedDirs: [dataDir, process.env.SystemRoot ?? '', join(__dirname, '..')].filter(Boolean),
});
let scared: Scared[] = [];
let burnRequests: string[] = [];

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
    autoFortune: !!settings.autoFortune,
    fortuneRepos: [...new Set([...(settings.fortuneRepos ?? []), ...(settings.hookRepos ?? [])])],
    souls: soulViews(),
    underworldDays: settings.underworldDays || 30,
    scared: settings.closed || settings.features.shoujing === false ? [] : scared,
    puduWhitelist: settings.puduWhitelist ?? [],
    puduReminder: puduReminder(),
    windows: sys.isWindows,
    guaiguai: guaiguaiView(),
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
  void syncEffects(); // 閉廟會把不乖效果全部還原
  return broadcast();
}

function openTemple(): TempleState {
  store.updateSettings({ closed: false });
  void syncEffects();
  return broadcast();
}

// ───────── 綠色乖乖 ─────────

const PACIFY_MS = 60 * 60 * 1000;

const effects = new Effects({
  store,
  dataDir,
  crumbsPage: join(__dirname, 'renderer', 'crumbs.html'),
  // 圖片的旋轉交給主殿畫面的 canvas 做（主殿視窗即使收在系統匣也還在）。
  rotateImage: (dataUrl, degrees) => {
    if (!win || win.isDestroyed()) return Promise.reject(new Error('no window'));
    return win.webContents.executeJavaScript(`window.saiboRotate(${JSON.stringify(dataUrl)}, ${degrees})`) as Promise<string>;
  },
});

/** 現在該不該不乖：功能開著、沒閉廟、供奉的乖乖已過期、而且不在安撫期間。 */
function shouldMisbehave(): boolean {
  const s = store.getSettings();
  if (quitting || s.closed || s.features.guaiguai === false) return false;
  if (Date.now() < (s.guaiguaiPacifiedUntil || 0)) return false;
  return guaiguaiStatus(s.guaiguaiExpiry, today()).expired;
}

function guaiguaiView(): TempleState['guaiguai'] {
  const s = store.getSettings();
  const left = (s.guaiguaiPacifiedUntil || 0) - Date.now();
  return { ...guaiguaiStatus(s.guaiguaiExpiry, today()), misbehaving: effects.isActive, pacifiedMinutes: left > 0 ? Math.ceil(left / 60000) : 0 };
}

let pacifyTimer: NodeJS.Timeout | null = null;

/** 依目前狀態開或關不乖效果。任何會影響條件的地方都要呼叫。 */
async function syncEffects(): Promise<void> {
  const on = shouldMisbehave();
  await effects.set(on);
  // 沒在不乖時，確保桌布一定是原樣（例如上次 App 異常結束，桌布還歪著）。
  if (!on) await effects.restoreWallpaper();
  // 安撫時間到了要自動恢復不乖。
  if (pacifyTimer) clearTimeout(pacifyTimer);
  const left = (store.getSettings().guaiguaiPacifiedUntil || 0) - Date.now();
  if (left > 0) pacifyTimer = setTimeout(() => void syncEffects(), left + 500).unref();
  broadcast();
}

let ocrWorker: Promise<import('tesseract.js').Worker> | null = null;

async function readGuaiguai(imageDataUrl: string): Promise<{ date: string | null; text: string }> {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(imageDataUrl);
  if (!m) return { date: null, text: '' };
  try {
    // 文字辨識完全在本機執行；語言資料跟著 App 一起安裝，不需要網路。
    ocrWorker ??= import('tesseract.js').then(({ createWorker }) =>
      createWorker('eng', 1, {
        langPath: join(__dirname, '..', 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int'),
        cachePath: join(dataDir, 'guaiguai'),
        gzip: true,
      }),
    );
    const worker = await ocrWorker;
    const { data } = await worker.recognize(Buffer.from(m[2], 'base64'));
    return { date: parseExpiry(data.text), text: data.text };
  } catch {
    ocrWorker = null;
    return { date: null, text: '' };
  }
}

// ───────── 陰間回收筒 ─────────

function soulViews(): TempleState['souls'] {
  const days = store.getSettings().underworldDays || 30;
  const now = today().getTime();
  return underworld
    .list()
    .map((s) => {
      const d = Math.floor((now - new Date(s.burnedAt).getTime()) / 86400000);
      return { ...s, days: Math.max(d, 0), overdue: d > days };
    })
    .reverse();
}

/** 從啟動參數裡找出「燒給它」送來的檔案（檔案總管右鍵選單會這樣呼叫）。 */
function burnArgs(argv: string[]): string[] {
  // 用 --burn=路徑 的形式：Chromium 會把參數重新排序，分開寫會和其他參數混在一起。
  return argv.filter((a) => a.startsWith('--burn=')).map((a) => a.slice('--burn='.length)).filter(Boolean);
}

function queueBurn(paths: string[]): void {
  if (paths.length === 0) return;
  burnRequests.push(...paths);
  showWindow();
  if (win && !win.webContents.isLoading()) win.webContents.send('underworld:burnRequest', paths);
}

function burnFiles(paths: string[]): ActionResult {
  if (store.getSettings().closed) return { ok: false, message: '閉廟中，不收東西。' };
  if (!featureOn('underworld')) return { ok: false, message: '陰間回收筒已關閉。' };
  const done: string[] = [];
  const failed: string[] = [];
  for (const p of paths) {
    try {
      done.push(underworld.burn(p).name);
    } catch (e) {
      failed.push(`${p}（${e instanceof Error ? e.message : '失敗'}）`);
    }
  }
  broadcast();
  return {
    ok: failed.length === 0,
    message: [done.length ? `已燒到陰間：${done.join('、')}` : '', failed.length ? `沒燒成：${failed.join('；')}` : ''].filter(Boolean).join('。'),
  };
}

function restoreSoul(id: string, forced: boolean): ActionResult {
  // 還陽永遠可用，閉廟中也一樣：檔案絕對不能拿不回來。
  try {
    const r = underworld.restore(id);
    if (forced) ledger.append({ feature: '陰間回收筒', action: '強制還陽', target: r.soul.originalPath, confession: '' });
    broadcast();
    return { ok: true, message: r.relocated ? `原本的位置回不去，已還陽到：${r.restoredTo}` : `已還陽：${r.restoredTo}` };
  } catch (e) {
    broadcast();
    return { ok: false, message: e instanceof Error ? e.message : '還陽失敗' };
  }
}

async function releaseSouls(ids: string[]): Promise<ActionResult> {
  const done: string[] = [];
  const failed: string[] = [];
  for (const soul of underworld.list().filter((s) => ids.includes(s.id))) {
    try {
      // 超渡 = 移到 Windows 真正的回收筒，仍然可以從那裡救回來。
      await shell.trashItem(underworld.pathOf(soul));
      underworld.forget(soul.id);
      done.push(soul.name);
    } catch {
      failed.push(soul.name);
    }
  }
  broadcast();
  return {
    ok: failed.length === 0,
    message: [done.length ? `已超渡到資源回收筒：${done.join('、')}` : '', failed.length ? `沒能超渡（仍留在陰間）：${failed.join('、')}` : ''].filter(Boolean).join('。'),
  };
}

function burnCommand(): string {
  // 開發時要把專案資料夾交給 Electron；打包後執行檔本身就是 App。
  const appRoot = join(__dirname, '..');
  return app.isPackaged ? `"${process.execPath}" "--burn=%1"` : `"${process.execPath}" "${appRoot}" "--burn=%1"`;
}

// ───────── 收驚 ─────────

async function checkCrashes(): Promise<void> {
  const s = store.getSettings();
  if (s.closed || s.features.shoujing === false) return;
  const crashes = await sys.listCrashes(SCARE_WINDOW_MS / 60000);
  const before = scared.map((x) => x.key).join('|');
  scared = findScared(crashes, new Date(), s.shoujingHandled ?? []);
  if (scared.map((x) => x.key).join('|') !== before) {
    const fresh = scared[0];
    if (fresh && Notification.isSupported()) {
      const n = new Notification({ title: '賽博宮：有程式被嚇到了', body: `${fresh.name} 一小時內當掉 ${fresh.count} 次，要不要幫它收驚？` });
      n.on('click', showWindow);
      n.show();
    }
    broadcast();
  }
}

function restartProgram(path: string): ActionResult {
  if (!path || !existsSync(path)) return { ok: false, message: '找不到這個程式的位置，請自己重新開啟。' };
  try {
    spawn(path, [], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, message: `已重新啟動 ${path}` };
  } catch {
    return { ok: false, message: '啟動失敗，請自己重新開啟。' };
  }
}

// ───────── 中元普渡 ─────────

function puduReminder(): TempleState['puduReminder'] {
  const s = store.getSettings();
  if (s.closed || s.features.pudu === false) return 'none';
  const a = getAlmanac(today());
  if (!a.ghostMonth) return 'none';
  if (a.zhongyuan) return s.zhongyuanNotified === a.date ? 'none' : 'zhongyuan';
  return s.puduRemindedYear === today().getFullYear() ? 'none' : 'ghostMonth';
}

async function currentGhosts(): Promise<Ghost[]> {
  const procs = await sys.listProcesses();
  return findGhosts(procs, {
    now: new Date(),
    systemRoot: process.env.SystemRoot ?? 'C:\\Windows',
    selfPids: [process.pid, ...app.getAppMetrics().map((m) => m.pid)],
    selfPath: process.execPath,
    whitelist: store.getSettings().puduWhitelist ?? [],
  });
}

async function releaseGhosts(pids: number[]): Promise<{ released: string[]; skipped: string[] }> {
  const released: string[] = [];
  const skipped: string[] = [];
  if (store.getSettings().closed) return { released, skipped: ['閉廟中，不辦普渡'] };
  // 動手前重新確認一次：只結束「現在仍然符合條件」的程式，避免名單過期誤傷。
  const now = await currentGhosts();
  for (const pid of pids) {
    const g = now.find((x) => x.pid === pid);
    if (!g) {
      skipped.push(`${pid}（已經不在或不再符合條件）`);
      continue;
    }
    try {
      process.kill(pid);
      released.push(g.name);
    } catch {
      skipped.push(`${g.name}（結束不了，可能需要系統管理員權限）`);
    }
  }
  return { released, skipped };
}

function zhongyuanNotify(): void {
  if (puduReminder() !== 'zhongyuan' || !Notification.isSupported()) return;
  const n = new Notification({ title: '賽博宮：今日中元', body: '農曆七月十五，要不要辦一場普渡，超渡沒有回應的程式？' });
  n.on('click', showWindow);
  n.show();
}

// ───────── 籤詩 code review ─────────

let lastFortune: FortuneReport | null = null;

async function fortuneFor(dir: string, preferredBase?: string): Promise<{ ok: true; report: FortuneReport } | { ok: false; message: string }> {
  if (!hooks.gitAvailable()) return { ok: false, message: '找不到 git，請先安裝 Git。' };
  const root = hooks.repoRoot(dir);
  if (!root) return { ok: false, message: '這個資料夾不是 git repo。' };
  try {
    const report = await drawFortune({
      repoPath: root,
      repoName: repoName(root),
      preferredBase,
      nameology: featureOn('nameology'),
      strokeTable: loadStrokeTable(dataDir, join(__dirname, 'assets', 'letter-strokes.json')),
    });
    lastFortune = report;
    const recent = [root, ...(store.getSettings().fortuneRepos ?? []).filter((p) => p !== root)].slice(0, 8);
    store.updateSettings({ fortuneRepos: recent });
    return { ok: true, report };
  } catch (e) {
    return { ok: false, message: `抽籤失敗：${e instanceof Error ? e.message.split('\n')[0] : String(e)}` };
  }
}

/** push 前自動抽籤：只顯示結果，不影響 push 准不准。 */
function autoFortune(info: PushInfo): void {
  const s = store.getSettings();
  if (s.closed || !s.autoFortune || !featureOn('fortune')) return;
  void fortuneFor(info.repoPath, info.refs[0]?.remoteSha).then((r) => {
    if (r.ok) win?.webContents.send('fortune:ready', r.report);
    broadcast();
  });
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
    autoFortune(info);
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
  app.on('second-instance', (_e, argv) => {
    const paths = burnArgs(argv);
    if (paths.length) queueBurn(paths);
    else showWindow();
  });
  let cleanedUp = false;
  app.on('before-quit', (e) => {
    quitting = true;
    // 離開前先把桌布等效果還原，還原完才真的結束。
    if (!cleanedUp) {
      e.preventDefault();
      void effects.set(false).finally(() => {
        cleanedUp = true;
        app.quit();
      });
    }
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
      void syncEffects();
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

    ipcMain.handle('underworld:choose', async () => {
      const r = win
        ? await dialog.showOpenDialog(win, { title: '選擇要燒到陰間的檔案', properties: ['openFile', 'multiSelections'] })
        : { canceled: true, filePaths: [] as string[] };
      return r.canceled ? [] : r.filePaths;
    });
    ipcMain.handle('underworld:pullBurn', () => {
      const list = burnRequests;
      burnRequests = [];
      return list;
    });
    ipcMain.handle('underworld:burn', (_e, paths: string[]) => {
      burnRequests = [];
      return burnFiles((paths ?? []).map(String));
    });
    ipcMain.handle('underworld:restore', (_e, id: string, forced: boolean) => restoreSoul(String(id), !!forced));
    ipcMain.handle('underworld:release', (_e, ids: string[]) => releaseSouls((ids ?? []).map(String)));
    ipcMain.handle('underworld:menuStatus', () => sys.contextMenuInstalled());
    ipcMain.handle('underworld:menuSet', (_e, on: boolean) =>
      on ? sys.installContextMenu(burnCommand(), process.execPath) : sys.uninstallContextMenu(),
    );

    ipcMain.handle('shoujing:check', async () => {
      await checkCrashes();
      return buildState();
    });
    ipcMain.handle('shoujing:finish', (_e, key: string) => {
      const handled = [...(store.getSettings().shoujingHandled ?? []), String(key)].slice(-50);
      store.updateSettings({ shoujingHandled: handled });
      scared = scared.filter((x) => x.key !== key);
      return broadcast();
    });
    ipcMain.handle('shoujing:restart', (_e, path: string) => restartProgram(String(path)));

    ipcMain.handle('pudu:find', () => (store.getSettings().closed ? [] : currentGhosts()));
    ipcMain.handle('pudu:release', (_e, pids: number[]) => releaseGhosts((pids ?? []).map(Number)));
    ipcMain.handle('pudu:setWhitelist', (_e, text: string) => {
      store.updateSettings({ puduWhitelist: parseWhitelist(String(text ?? '')) });
      return broadcast();
    });
    ipcMain.handle('pudu:dismissReminder', () => {
      const a = getAlmanac(today());
      store.updateSettings(a.zhongyuan ? { zhongyuanNotified: a.date } : { puduRemindedYear: today().getFullYear() });
      return broadcast();
    });

    ipcMain.handle('guaiguai:read', (_e, image: string) => readGuaiguai(String(image)));
    ipcMain.handle('guaiguai:register', async (_e, expiry: string): Promise<ActionResult> => {
      if (!isValidDate(String(expiry))) return { ok: false, message: '日期格式不對，請用 西元年-月-日，例如 2027-03-15。' };
      store.updateSettings({ guaiguaiExpiry: String(expiry), guaiguaiPacifiedUntil: 0 });
      await syncEffects(); // 換上新乖乖：還沒過期的話，不乖效果全部還原
      const g = guaiguaiView();
      return { ok: true, message: g.expired ? `這包已經過期 ${-g.daysLeft} 天了，鎮不住。` : `供奉完成，還有 ${g.daysLeft} 天到期。` };
    });
    ipcMain.handle('guaiguai:pacify', async () => {
      store.updateSettings({ guaiguaiPacifiedUntil: Date.now() + PACIFY_MS });
      await syncEffects();
      return buildState();
    });

    ipcMain.handle('fortune:draw', async (_e, dir: string) => {
      if (store.getSettings().closed) return { ok: false, message: '閉廟中，不抽籤。' };
      if (!featureOn('fortune')) return { ok: false, message: '籤詩 code review 已關閉。' };
      const r = await fortuneFor(String(dir));
      broadcast();
      return r;
    });
    ipcMain.handle('fortune:last', () => lastFortune);
    ipcMain.handle('fortune:setAuto', (_e, on: boolean) => {
      store.updateSettings({ autoFortune: !!on });
      return broadcast();
    });

    ipcMain.handle('ritual:pull', () => (hookServer.active ? toRitual(hookServer.active) : null));
    ipcMain.handle('ritual:finish', (_e, id: string, outcome: RitualOutcome) => finishRitual(String(id), { ...outcome }));

    hookServer.start();
    createTray();
    createWindow();

    // 檔案總管右鍵「燒給它」啟動 App 時，檔案路徑在啟動參數裡。
    burnRequests = burnArgs(process.argv);
    // 收驚：開門時看一次，之後每五分鐘看一次當機紀錄。
    void checkCrashes();
    setInterval(() => void checkCrashes(), 5 * 60 * 1000).unref();
    zhongyuanNotify();

    // 綠色乖乖：允許主殿用鏡頭拍包裝（只給這個 App 自己的畫面）。
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media' && wc === win?.webContents));
    // 畫面載入好之後才能請它轉桌布；之後每十分鐘檢查一次有沒有過期。
    win?.webContents.once('did-finish-load', () => void syncEffects());
    setInterval(() => void syncEffects(), 10 * 60 * 1000).unref();
  });
}
