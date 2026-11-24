// 綠色乖乖過期後的「不乖」效果。全部只是視覺效果，而且隨時可以一鍵還原：
//   1. 桌布歪掉（原本的桌布會先記下來，還原時設回去）
//   2. 游標偶爾抖一下（有頻率上限，按著滑鼠鍵時不抖）
//   3. 畫面上偶爾掉乖乖碎屑（透明、滑鼠可穿透的置頂視窗）

import { BrowserWindow, screen } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Store } from '../core/store.ts';
import { desktopSupported, getWallpaper, jitterCursor, setWallpaper } from './desktop.ts';

const TILT_DEGREES = 3;
const fast = !!process.env.SAIBO_FAST_EFFECTS; // 開發測試用：把間隔縮短
const JITTER_MIN_MS = fast ? 600 : 2 * 60 * 1000; // 游標最少隔這麼久才抖一次（頻率上限）
const JITTER_MAX_MS = fast ? 900 : 6 * 60 * 1000;

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.bmp': 'image/bmp', '.webp': 'image/webp', '.gif': 'image/gif' };

export interface EffectsDeps {
  store: Store;
  dataDir: string;
  /** 請主殿畫面把圖片轉個角度，回傳 PNG 的 data URL。 */
  rotateImage(dataUrl: string, degrees: number): Promise<string>;
  crumbsPage: string;
}

export class Effects {
  private active = false;
  private busy: Promise<void> = Promise.resolve();
  private jitterTimer: NodeJS.Timeout | null = null;
  private overlay: BrowserWindow | null = null;
  private readonly deps: EffectsDeps;

  constructor(deps: EffectsDeps) {
    this.deps = deps;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** 開或關全部效果。動作排隊執行，避免桌布的設定和還原互相打架。 */
  set(on: boolean): Promise<void> {
    this.busy = this.busy.then(() => (on ? this.start() : this.stop())).catch(() => {});
    return this.busy;
  }

  private async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    await this.tiltWallpaper();
    this.scheduleJitter();
    this.showCrumbs();
  }

  private async stop(): Promise<void> {
    this.active = false;
    if (this.jitterTimer) clearTimeout(this.jitterTimer);
    this.jitterTimer = null;
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.destroy();
    this.overlay = null;
    await this.restoreWallpaper();
  }

  // ───── 桌布 ─────

  private async tiltWallpaper(): Promise<void> {
    const { store, dataDir } = this.deps;
    if (!desktopSupported || store.getSettings().wallpaperBackup) return; // 已經歪了就不重複處理
    try {
      const original = await getWallpaper();
      const mime = MIME[extname(original).toLowerCase()];
      // 純色背景、幻燈片等沒有固定圖檔的情況，不動桌布。
      if (!original || !existsSync(original) || !mime) return;
      const dir = join(dataDir, 'guaiguai');
      mkdirSync(dir, { recursive: true });
      const backupFile = join(dir, `wallpaper-backup${extname(original).toLowerCase()}`);
      copyFileSync(original, backupFile);
      const tilted = await this.deps.rotateImage(`data:${mime};base64,${readFileSync(original).toString('base64')}`, TILT_DEGREES);
      const m = /^data:image\/png;base64,(.+)$/.exec(tilted);
      if (!m) return;
      // 檔名帶時間：同一個檔名 Windows 可能不會重新載入。
      const tiltedFile = join(dir, `wallpaper-tilted-${Date.now()}.png`);
      writeFileSync(tiltedFile, Buffer.from(m[1], 'base64'));
      // 先把「原本是哪一張」記下來，再動桌布；這樣中途出任何事都還原得回去。
      store.updateSettings({ wallpaperBackup: { originalPath: original, backupFile } });
      if (!(await setWallpaper(tiltedFile))) {
        store.updateSettings({ wallpaperBackup: null });
      }
    } catch {
      /* 桌布弄不歪就算了，不影響其他效果 */
    }
  }

  /** 把桌布設回原本那一張。原檔不見了就用備份。 */
  async restoreWallpaper(): Promise<void> {
    const { store } = this.deps;
    const b = store.getSettings().wallpaperBackup;
    if (!b) return;
    try {
      const target = existsSync(b.originalPath) ? b.originalPath : b.backupFile;
      if (existsSync(target) && (await setWallpaper(target))) store.updateSettings({ wallpaperBackup: null });
    } catch {
      /* 下次再試；紀錄還留著 */
    }
  }

  // ───── 游標 ─────

  private scheduleJitter(): void {
    const wait = JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS);
    this.jitterTimer = setTimeout(() => {
      if (!this.active) return;
      const d = 5 + Math.floor(Math.random() * 6);
      void jitterCursor(Math.random() < 0.5 ? d : -d, Math.random() < 0.5 ? 2 : -2).finally(() => {
        if (this.active) this.scheduleJitter();
      });
    }, wait);
    this.jitterTimer.unref();
  }

  // ───── 碎屑 ─────

  private showCrumbs(): void {
    if (this.overlay && !this.overlay.isDestroyed()) return;
    const { bounds } = screen.getPrimaryDisplay();
    this.overlay = new BrowserWindow({
      ...bounds,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    this.overlay.setIgnoreMouseEvents(true); // 滑鼠直接穿過去，不擋任何操作
    this.overlay.setAlwaysOnTop(true, 'screen-saver');
    void this.overlay.loadFile(this.deps.crumbsPage, { query: fast ? { fast: '1' } : {} });
    this.overlay.once('ready-to-show', () => this.overlay?.showInactive());
  }

  get overlayVisible(): boolean {
    return !!this.overlay && !this.overlay.isDestroyed();
  }
}
