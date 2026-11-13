// 主程序和畫面之間的介面。畫面只能透過這些函式碰到系統。

import type { PoeThrow } from '../core/poe.ts';
import type { LedgerEntry } from '../core/ledger.ts';
import type { Stats } from '../core/store.ts';
import type { ConfessionLength } from '../core/confession.ts';
import type { Almanac } from '../core/almanac.ts';

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

  /** 畫面準備好了，領取正在等的儀式（沒有就是 null）。 */
  pullRitual(): Promise<RitualRequest | null>;
  finishRitual(id: string, outcome: RitualOutcome): Promise<void>;
  onRitualStart(cb: (r: RitualRequest) => void): void;
  onRitualCancel(cb: (id: string) => void): void;
  onStateChanged(cb: (s: TempleState) => void): void;
}
