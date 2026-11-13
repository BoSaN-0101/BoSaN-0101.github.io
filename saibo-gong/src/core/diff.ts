// 找出「這次改動」：和上次 push 比較，哪些檔案的哪幾行是新的。

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface FileChange {
  file: string; // 相對於 repo 根目錄，用 / 分隔
  lines: Set<number>; // 新版檔案裡新增或修改的行號
  added: string[]; // 那些行的內容
  oldText: string; // 改動前整個檔案的內容（新檔案是空字串）
}

export interface ChangeSet {
  base: string; // 比較的基準（給人看的說明）
  files: FileChange[];
  totalLines: number;
}

export function git(repo: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

const tryGit = (repo: string, args: string[]) => git(repo, args).then((s) => s.trim(), () => '');

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** 決定比較基準：上游分支的分岔點；沒有上游就找 origin 的主要分支；都沒有就當整個 repo 都是新的。 */
export async function findBase(repo: string, preferred?: string): Promise<{ rev: string; desc: string }> {
  if (preferred && /^[0-9a-f]{40}$/.test(preferred) && !/^0+$/.test(preferred)) {
    if (await tryGit(repo, ['cat-file', '-t', preferred])) return { rev: preferred, desc: '遠端目前的版本' };
  }
  const head = await tryGit(repo, ['rev-parse', '--verify', '-q', 'HEAD']);
  if (!head) return { rev: EMPTY_TREE, desc: '全新的 repo（全部視為新增）' };
  for (const ref of ['@{upstream}', 'origin/HEAD', 'origin/main', 'origin/master']) {
    const mb = await tryGit(repo, ['merge-base', 'HEAD', ref]);
    if (mb) return { rev: mb, desc: `上次 push（${ref === '@{upstream}' ? '上游分支' : ref}）` };
  }
  return { rev: EMPTY_TREE, desc: '還沒 push 過（全部視為新增）' };
}

/** 解析 git diff -U0 的輸出。 */
export function parseDiff(text: string): Map<string, { lines: Set<number>; added: string[] }> {
  const out = new Map<string, { lines: Set<number>; added: string[] }>();
  let cur: { lines: Set<number>; added: string[] } | null = null;
  let lineNo = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      cur = null;
      if (p !== '/dev/null') {
        const file = p.replace(/^"?b\//, '').replace(/"$/, '');
        cur = { lines: new Set(), added: [] };
        out.set(file, cur);
      }
    } else if (line.startsWith('@@')) {
      const m = /\+(\d+)/.exec(line);
      lineNo = m ? Number(m[1]) : 0;
    } else if (cur && line.startsWith('+') && !line.startsWith('+++')) {
      cur.lines.add(lineNo++);
      cur.added.push(line.slice(1));
    }
  }
  return out;
}

export async function collectChanges(repo: string, preferredBase?: string): Promise<ChangeSet> {
  const base = await findBase(repo, preferredBase);
  const diff = await git(repo, ['diff', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=ACMR', base.rev, '--']);
  const parsed = parseDiff(diff);
  // 還沒加入 git 的新檔案也算這次的改動。
  const untracked = (await tryGit(repo, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean);
  for (const file of untracked) {
    const full = join(repo, file);
    if (parsed.has(file) || !existsSync(full)) continue;
    let text: string;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000') || text.length > 2_000_000) continue;
    const lines = text.split(/\r?\n/);
    parsed.set(file, { lines: new Set(lines.map((_, i) => i + 1)), added: lines });
  }
  const files: FileChange[] = [];
  for (const [file, c] of parsed) {
    if (!existsSync(join(repo, file))) continue;
    const oldText = await git(repo, ['show', `${base.rev}:${file}`]).catch(() => '');
    files.push({ file, lines: c.lines, added: c.added, oldText });
  }
  return { base: base.desc, files, totalLines: files.reduce((n, f) => n + f.lines.size, 0) };
}
