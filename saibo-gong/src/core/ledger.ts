// 功過簿：只能新增的永久紀錄。
// 每筆包含前一筆的雜湊值，串成一條鏈；另外有一個 head 檔記住筆數和最後一筆的雜湊，
// 用來發現「尾巴被整段砍掉」這種只看鏈本身查不出來的竄改。

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LedgerInput {
  feature: string; // 功能，例如「主殿」「擲筊 push」
  action: string; // 行為，例如「閉廟」「硬闖」「強制還陽」
  target: string; // 對象，例如哪個 repo、哪個檔案
  confession: string; // 使用者打的懺悔文（沒有就空字串）
}

export interface LedgerEntry extends LedgerInput {
  seq: number;
  time: string; // ISO 8601
  prevHash: string;
  hash: string;
}

export interface LedgerCheck {
  ok: boolean;
  entries: LedgerEntry[]; // 能讀出來的紀錄（即使遭竄改也盡量列出）
  brokenAt?: number; // 第幾筆開始對不上（從 1 起算）
  reason?: string;
}

export const GENESIS_HASH = '0'.repeat(64);

export function hashEntry(e: Omit<LedgerEntry, 'hash'>): string {
  const payload = JSON.stringify([e.seq, e.time, e.feature, e.action, e.target, e.confession, e.prevHash]);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

interface Head {
  count: number;
  hash: string;
}

export class Ledger {
  readonly file: string;
  readonly headFile: string;
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    this.file = join(dir, 'ledger.jsonl');
    this.headFile = join(dir, 'ledger.head.json');
  }

  private readHead(): Head | null {
    if (!existsSync(this.headFile)) return null;
    try {
      const h = JSON.parse(readFileSync(this.headFile, 'utf8'));
      if (typeof h.count === 'number' && typeof h.hash === 'string') return h;
    } catch {
      /* 壞掉的 head 視同不存在，由 verify 判定 */
    }
    return null;
  }

  private writeHead(head: Head): void {
    const tmp = this.headFile + '.tmp';
    writeFileSync(tmp, JSON.stringify(head), 'utf8');
    renameSync(tmp, this.headFile);
  }

  /** 檢查整條鏈。App 啟動時呼叫。 */
  verify(): LedgerCheck {
    const head = this.readHead();
    const headBroken = existsSync(this.headFile) && !head;
    if (!existsSync(this.file)) {
      if (head && head.count > 0) return { ok: false, entries: [], brokenAt: 1, reason: '功過簿檔案不見了' };
      return { ok: true, entries: [] };
    }
    const lines = readFileSync(this.file, 'utf8').split('\n').filter((l) => l.trim() !== '');
    const entries: LedgerEntry[] = [];
    let problem: { brokenAt: number; reason: string } | undefined;
    let prev = GENESIS_HASH;
    lines.forEach((line, i) => {
      const n = i + 1;
      let e: LedgerEntry;
      try {
        e = JSON.parse(line);
      } catch {
        problem ??= { brokenAt: n, reason: `第 ${n} 筆無法讀取` };
        return;
      }
      entries.push(e);
      if (problem) return;
      if (e.seq !== n) problem = { brokenAt: n, reason: `第 ${n} 筆的序號不對（有紀錄被刪除或調換）` };
      else if (e.prevHash !== prev) problem = { brokenAt: n, reason: `第 ${n} 筆接不上前一筆` };
      else if (hashEntry(e) !== e.hash) problem = { brokenAt: n, reason: `第 ${n} 筆的內容被改過` };
      prev = e.hash;
    });
    if (problem) return { ok: false, entries, ...problem };

    const last = entries.length ? entries[entries.length - 1].hash : GENESIS_HASH;
    if (headBroken) return { ok: false, entries, brokenAt: entries.length + 1, reason: '功過簿的封印檔毀損' };
    if (!head) {
      if (entries.length > 0) return { ok: false, entries, brokenAt: entries.length + 1, reason: '功過簿的封印檔不見了' };
      return { ok: true, entries };
    }
    if (head.count === entries.length && head.hash === last) return { ok: true, entries };
    // 上次寫入一筆之後、更新封印之前就中斷：多出恰好一筆且接得上，補上封印即可。
    if (entries.length === head.count + 1 && entries[entries.length - 1].prevHash === head.hash) {
      this.writeHead({ count: entries.length, hash: last });
      return { ok: true, entries };
    }
    if (entries.length < head.count) {
      return { ok: false, entries, brokenAt: entries.length + 1, reason: `功過簿少了 ${head.count - entries.length} 筆（尾端被刪除）` };
    }
    return { ok: false, entries, brokenAt: head.count + 1, reason: '功過簿與封印對不上' };
  }

  list(): LedgerEntry[] {
    return this.verify().entries;
  }

  /** 新增一筆。這是唯一的寫入途徑，沒有修改和刪除。 */
  append(input: LedgerInput, now: Date = new Date()): LedgerEntry {
    mkdirSync(this.dir, { recursive: true });
    const entries = this.list();
    const prevHash = entries.length ? entries[entries.length - 1].hash : GENESIS_HASH;
    const base = {
      seq: entries.length + 1,
      time: now.toISOString(),
      feature: input.feature,
      action: input.action,
      target: input.target,
      confession: input.confession,
      prevHash,
    };
    const entry: LedgerEntry = { ...base, hash: hashEntry(base) };
    const before = this.verify();
    appendFileSync(this.file, JSON.stringify(entry) + '\n', 'utf8');
    // 鏈已經壞掉時不更新封印，免得把竄改「洗白」。
    if (before.ok) this.writeHead({ count: entry.seq, hash: entry.hash });
    return entry;
  }
}
