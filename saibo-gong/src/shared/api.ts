// 主程序和畫面之間的介面。畫面只能透過這些函式碰到系統。

import type { PoeThrow } from '../core/poe.ts';
import type { LedgerEntry } from '../core/ledger.ts';
import type { Stats } from '../core/store.ts';

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

export interface TempleApi {
  getState(): Promise<TempleState>;
  throwPoe(): Promise<PoeThrow>;
  getLedger(): Promise<LedgerView>;
  closeTemple(): Promise<TempleState>;
  openTemple(): Promise<TempleState>;
  setFeature(id: string, enabled: boolean): Promise<TempleState>;
  pickConfession(): Promise<ConfessionPrompt>;
  onStateChanged(cb: (s: TempleState) => void): void;
}
