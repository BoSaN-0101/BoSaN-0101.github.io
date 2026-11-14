// 設定與擲筊統計（統計不是功過簿：功過簿只記違逆神明的行為）。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PoeResult } from './poe.ts';
import { DEFAULT_CONFESSION_LENGTH, type ConfessionLength } from './confession.ts';
import { DEFAULT_PROTECTED } from './push.ts';

export interface Settings {
  closed: boolean; // 閉廟中
  features: Record<string, boolean>;
  confessionLength: ConfessionLength;
  confessionHintShown: boolean; // 第一次打完懺悔文後的「可調整長度」提示是否已出現過
  protectedBranches: string[]; // push 到這些分支算「正式上線」
  hookRepos: string[]; // 個別安裝了擲筊 push 的 repo
  autoFortune: boolean; // push 前自動抽籤（只顯示，不擋）
  fortuneRepos: string[]; // 抽過籤的 repo，方便下次選
  underworldDays: number; // 陰間的檔案超過幾天提議超渡
  shoujingHandled: string[]; // 已經收過驚的當機批次
  puduWhitelist: string[]; // 普渡永遠不碰的程式
  puduRemindedYear: number; // 哪一年的農曆七月已經提醒過
  zhongyuanNotified: string; // 哪一天的中元正日已經通知過
  guaiguaiExpiry: string; // 綠色乖乖的有效日期 YYYY-MM-DD，沒供奉是空字串
  guaiguaiPacifiedUntil: number; // 暫時安撫到什麼時候（毫秒時間戳）
  /** 桌布被弄歪時記下原本的桌布，用來還原。沒有動過桌布就是 null。 */
  wallpaperBackup: { originalPath: string; backupFile: string } | null;
}

export interface Stats {
  throws: number;
  sheng: number;
  xiao: number;
  yin: number;
  pushes: number; // 經過主殿的 push 次數
  pushBlessed: number; // 擲到聖筊放行
  pushDefied: number; // 硬闖
  pushAbandoned: number; // 作罷
  pushAbsent: number; // 神明不在，放行
}

export type PushOutcome = 'pushBlessed' | 'pushDefied' | 'pushAbandoned' | 'pushAbsent';

const DEFAULT_SETTINGS: Settings = { closed: false, features: {}, confessionLength: DEFAULT_CONFESSION_LENGTH, confessionHintShown: false, protectedBranches: DEFAULT_PROTECTED, hookRepos: [], autoFortune: false, fortuneRepos: [], underworldDays: 30, shoujingHandled: [], puduWhitelist: [], puduRemindedYear: 0, zhongyuanNotified: '', guaiguaiExpiry: '', guaiguaiPacifiedUntil: 0, wallpaperBackup: null };
const DEFAULT_STATS: Stats = { throws: 0, sheng: 0, xiao: 0, yin: 0, pushes: 0, pushBlessed: 0, pushDefied: 0, pushAbandoned: 0, pushAbsent: 0 };

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return structuredClone(fallback);
  try {
    return { ...structuredClone(fallback), ...JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(dir: string, file: string, data: unknown): void {
  mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, file);
}

export class Store {
  private readonly dir: string;
  private readonly settingsFile: string;
  private readonly statsFile: string;

  constructor(dir: string) {
    this.dir = dir;
    this.settingsFile = join(dir, 'settings.json');
    this.statsFile = join(dir, 'stats.json');
  }

  getSettings(): Settings {
    return readJson(this.settingsFile, DEFAULT_SETTINGS);
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.getSettings(), ...patch };
    writeJson(this.dir, this.settingsFile, next);
    return next;
  }

  getStats(): Stats {
    return readJson(this.statsFile, DEFAULT_STATS);
  }

  recordThrow(result: PoeResult): Stats {
    const s = this.getStats();
    s.throws += 1;
    s[result] += 1;
    writeJson(this.dir, this.statsFile, s);
    return s;
  }

  recordPush(outcome: PushOutcome): Stats {
    const s = this.getStats();
    s.pushes += 1;
    s[outcome] += 1;
    writeJson(this.dir, this.statsFile, s);
    return s;
  }
}
