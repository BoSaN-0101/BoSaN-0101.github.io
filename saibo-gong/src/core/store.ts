// 設定與擲筊統計（統計不是功過簿：功過簿只記違逆神明的行為）。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PoeResult } from './poe.ts';
import { DEFAULT_CONFESSION_LENGTH, type ConfessionLength } from './confession.ts';

export interface Settings {
  closed: boolean; // 閉廟中
  features: Record<string, boolean>;
  confessionLength: ConfessionLength;
  confessionHintShown: boolean; // 第一次打完懺悔文後的「可調整長度」提示是否已出現過
}

export interface Stats {
  throws: number;
  sheng: number;
  xiao: number;
  yin: number;
}

const DEFAULT_SETTINGS: Settings = { closed: false, features: {}, confessionLength: DEFAULT_CONFESSION_LENGTH, confessionHintShown: false };
const DEFAULT_STATS: Stats = { throws: 0, sheng: 0, xiao: 0, yin: 0 };

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
}
