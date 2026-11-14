// 主程序和畫面之間的介面。畫面只能透過這些函式碰到系統。

import type { PoeThrow } from '../core/poe.ts';
import type { LedgerEntry } from '../core/ledger.ts';
import type { Stats } from '../core/store.ts';
import type { ConfessionLength } from '../core/confession.ts';
import type { Almanac } from '../core/almanac.ts';
import type { FortuneReport } from '../core/fortune.ts';
import type { Soul } from '../core/underworld.ts';
import type { Scared } from '../core/shoujing.ts';
import type { Ghost } from '../core/pudu.ts';

export interface FeatureInfo {
  id: string;
  name: string;
  desc: string;
  stage: string; // 在哪個階段實作
  available: boolean; // 這一版能不能用
  enabled: boolean;
}

export interface TempleState {
  closed: boolean;
  tampered: boolean;
  tamperReason?: string;
  ledgerCount: number;
  recentLedger: LedgerEntry[];
  stats: Stats;
  features: FeatureInfo[];
  dataDir: string;
  confessionLength: ConfessionLength;
  confessionHintShown: boolean;
  almanac: Almanac;
  protectedBranches: string[];
  autoFortune: boolean;
  fortuneRepos: string[]; // 可以直接選來抽籤的 repo
  souls: SoulView[]; // 陰間裡的檔案
  underworldDays: number;
  scared: Scared[]; // 被嚇到、還沒收驚的程式
  puduWhitelist: string[];
  puduReminder: 'none' | 'ghostMonth' | 'zhongyuan'; // 要不要提醒辦普渡
  windows: boolean; // 是不是在 Windows 上（收驚、普渡、右鍵選單只有 Windows 能用）
}

export interface SoulView extends Soul {
  days: number; // 在陰間待了幾天
  overdue: boolean; // 超過期限，可以提議超渡
}

export interface LedgerView {
  ok: boolean;
  reason?: string;
  brokenAt?: number;
  entries: LedgerEntry[];
}

export interface ConfessionPrompt {
  id: string;
  title: string;
  text: string;
}

/** 一場 push 儀式：主殿要使用者過哪幾關。 */
export interface RitualRequest {
  id: string;
  repo: string; // repo 名稱
  refs: string; // 這次推了什麼，例如「main、v1.0」
  almanacBlock: string | null; // 忌開市而且是正式上線時，說明擋下的原因；不用擋就是 null
  poe: boolean; // 要不要擲筊
  maxThrows: number;
}

export interface Defiance {
  confessionId: string;
  typed: string;
}

export interface RitualOutcome {
  allow: boolean;
  almanacDefied?: Defiance;
  poeDefied?: Defiance;
  blessed: boolean; // 擲到聖筊
}

export interface HookStatus {
  gitAvailable: boolean;
  global: boolean;
  repos: { path: string; installed: boolean }[];
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export interface TempleApi {
  getState(): Promise<TempleState>;
  throwPoe(): Promise<PoeThrow>;
  getLedger(): Promise<LedgerView>;
  closeTemple(): Promise<TempleState>;
  openTemple(): Promise<TempleState>;
  setFeature(id: string, enabled: boolean): Promise<TempleState>;
  pickConfession(): Promise<ConfessionPrompt>;
  setConfessionLength(length: ConfessionLength): Promise<TempleState>;
  markConfessionHintShown(): Promise<TempleState>;
  setProtectedBranches(text: string): Promise<TempleState>;

  getHookStatus(): Promise<HookStatus>;
  chooseFolder(): Promise<string | null>;
  installRepoHook(dir: string): Promise<ActionResult>;
  uninstallRepoHook(dir: string): Promise<ActionResult>;
  installGlobalHook(): Promise<ActionResult>;
  uninstallGlobalHook(): Promise<ActionResult>;

  // 陰間回收筒
  chooseFiles(): Promise<string[]>;
  /** 從檔案總管右鍵「燒給它」送進來、等著確認的檔案。 */
  pullBurnRequests(): Promise<string[]>;
  onBurnRequest(cb: (paths: string[]) => void): void;
  burnFiles(paths: string[]): Promise<ActionResult>;
  /** 擲到聖筊後還陽（forced = false），或不擲筊強制還陽（forced = true，會記入功過簿）。 */
  restoreSoul(id: string, forced: boolean): Promise<ActionResult>;
  /** 超渡：移到 Windows 真正的回收筒。 */
  releaseSouls(ids: string[]): Promise<ActionResult>;
  getContextMenu(): Promise<boolean>;
  setContextMenu(on: boolean): Promise<ActionResult>;

  // 收驚
  checkCrashes(): Promise<TempleState>;
  finishShoujing(key: string): Promise<TempleState>;
  restartProgram(path: string): Promise<ActionResult>;

  // 中元普渡
  findGhosts(): Promise<Ghost[]>;
  /** 結束使用者勾選的程式。 */
  releaseGhosts(pids: number[]): Promise<{ released: string[]; skipped: string[] }>;
  setPuduWhitelist(text: string): Promise<TempleState>;
  dismissPuduReminder(): Promise<TempleState>;

  /** 對一個 repo 抽籤（籤詩 code review）。 */
  drawFortune(dir: string): Promise<{ ok: true; report: FortuneReport } | { ok: false; message: string }>;
  getLastFortune(): Promise<FortuneReport | null>;
  setAutoFortune(on: boolean): Promise<TempleState>;
  /** push 前自動抽的籤出來了。 */
  onFortune(cb: (r: FortuneReport) => void): void;

  /** 畫面準備好了，領取正在等的儀式（沒有就是 null）。 */
  pullRitual(): Promise<RitualRequest | null>;
  finishRitual(id: string, outcome: RitualOutcome): Promise<void>;
  onRitualStart(cb: (r: RitualRequest) => void): void;
  onRitualCancel(cb: (id: string) => void): void;
  onStateChanged(cb: (s: TempleState) => void): void;
}
