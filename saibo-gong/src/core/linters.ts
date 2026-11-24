// 呼叫免費的靜態檢查工具（不執行程式、只讀程式碼找問題）：
// C/C++ 用 cppcheck，Python 用 ruff，JS/TS 用 eslint。沒安裝就跳過那個語言。

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

export type Lang = 'cpp' | 'python' | 'js';
export type Severity = 'error' | 'warning' | 'performance' | 'portability' | 'style' | 'information';

export interface Issue {
  tool: string;
  file: string; // 相對於 repo，用 / 分隔
  line: number;
  severity: Severity;
  id: string; // 工具給的規則代號
  message: string; // 工具的原文訊息
}

export interface ToolRun {
  lang: Lang;
  langName: string;
  tool: string;
  status: 'ok' | 'missing' | 'error';
  detail: string;
  files: number;
  issues: Issue[];
}

export const LANG_NAMES: Record<Lang, string> = { cpp: 'C/C++', python: 'Python', js: 'JavaScript/TypeScript' };
export const TOOL_OF: Record<Lang, string> = { cpp: 'cppcheck', python: 'ruff', js: 'eslint' };
const INSTALL_HINT: Record<Lang, string> = {
  cpp: '沒有安裝 cppcheck。安裝方式：winget install Cppcheck.Cppcheck',
  python: '沒有安裝 ruff。安裝方式：pip install ruff',
  js: '找不到 eslint。請在該專案執行 npm install -D eslint，或全域安裝 npm install -g eslint',
};

const EXT: Record<string, Lang> = {
  c: 'cpp', h: 'cpp', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  py: 'python', pyi: 'python',
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js',
};

export function langOf(file: string): Lang | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(file);
  return (m && EXT[m[1].toLowerCase()]) || null;
}

interface RunResult {
  missing: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], cwd: string, shell = false): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000, windowsHide: true, shell }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: string | number }) | null;
      const missing = !!e && (e.code === 'ENOENT' || (shell && /not recognized|not found|無法辨識/.test(String(stderr))));
      resolve({ missing, code: e ? (typeof e.code === 'number' ? e.code : null) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const rel = (repo: string, file: string) => (isAbsolute(file) ? relative(repo, file) : file).replace(/\\/g, '/');
const firstLine = (s: string) => s.trim().split('\n')[0]?.slice(0, 300) ?? '';

// ───── cppcheck ─────

const CPP_SEV: Record<string, Severity> = { error: 'error', warning: 'warning', performance: 'performance', portability: 'portability', style: 'style', information: 'information' };

export function parseCppcheck(text: string): Omit<Issue, 'tool'>[] {
  const out: Omit<Issue, 'tool'>[] = [];
  for (const line of text.split(/\r?\n/)) {
    const p = line.split('\t');
    if (p.length < 5 || !/^\d+$/.test(p[1])) continue;
    out.push({ file: p[0], line: Number(p[1]), severity: CPP_SEV[p[2]] ?? 'style', id: p[3], message: p.slice(4).join(' ') });
  }
  return out;
}

async function runCppcheck(repo: string, files: string[]): Promise<Omit<ToolRun, 'lang' | 'langName' | 'tool' | 'files'>> {
  const args = ['--enable=warning,style,performance,portability', '--inline-suppr', '--quiet', '--template={file}\t{line}\t{severity}\t{id}\t{message}', ...files];
  const candidates = ['cppcheck', 'C:\\Program Files\\Cppcheck\\cppcheck.exe'];
  for (const cmd of candidates) {
    if (cmd !== 'cppcheck' && !existsSync(cmd)) continue;
    const r = await run(cmd, args, repo);
    if (r.missing) continue;
    const issues = parseCppcheck(r.stderr)
      .filter((i) => i.severity !== 'information')
      .map((i) => ({ ...i, tool: 'cppcheck', file: rel(repo, i.file) }));
    return { status: 'ok', detail: '', issues };
  }
  return { status: 'missing', detail: INSTALL_HINT.cpp, issues: [] };
}

// ───── ruff ─────

export function ruffSeverity(code: string): Severity {
  if (!code || /^(E9|F63|F7|F82)/.test(code)) return 'error'; // 語法錯誤、未定義的名稱
  if (/^(F|B|S|PLE|PLW)/.test(code)) return 'warning';
  if (/^PERF/.test(code)) return 'performance';
  return 'style';
}

async function runRuff(repo: string, files: string[]): Promise<Omit<ToolRun, 'lang' | 'langName' | 'tool' | 'files'>> {
  const r = await run('ruff', ['check', '--output-format=json', '--no-fix', '--exit-zero', ...files], repo);
  if (r.missing) return { status: 'missing', detail: INSTALL_HINT.python, issues: [] };
  try {
    const list = JSON.parse(r.stdout) as { code: string | null; message: string; filename: string; location: { row: number } }[];
    return {
      status: 'ok',
      detail: '',
      issues: list.map((d) => ({ tool: 'ruff', file: rel(repo, d.filename), line: d.location.row, severity: ruffSeverity(d.code ?? ''), id: d.code ?? 'syntax-error', message: d.message })),
    };
  } catch {
    return { status: 'error', detail: `ruff 執行失敗：${firstLine(r.stderr || r.stdout)}`, issues: [] };
  }
}

// ───── eslint ─────

// 專案沒有 eslint 設定檔時用的基本規則：只挑不需要知道執行環境、幾乎不會誤判的。
const BASIC_RULES = [
  'no-unused-vars:warn', 'no-unreachable:error', 'no-dupe-keys:error', 'no-dupe-args:error', 'no-constant-condition:warn',
  'no-self-assign:error', 'no-self-compare:warn', 'no-dupe-else-if:error', 'no-duplicate-case:error', 'no-empty:warn',
  'no-func-assign:error', 'no-cond-assign:warn', 'no-unsafe-finally:error', 'use-isnan:error', 'valid-typeof:error',
  'no-redeclare:error', 'eqeqeq:warn', 'no-var:warn',
];

type EslintOut = { filePath: string; messages: { ruleId: string | null; severity: number; message: string; line?: number; fatal?: boolean }[] }[];

function parseEslint(repo: string, stdout: string): Issue[] | null {
  try {
    const list = JSON.parse(stdout.slice(stdout.indexOf('['))) as EslintOut;
    const issues: Issue[] = [];
    for (const f of list) {
      for (const m of f.messages) {
        issues.push({ tool: 'eslint', file: rel(repo, f.filePath), line: m.line ?? 1, severity: m.fatal || m.severity === 2 ? 'error' : 'warning', id: m.ruleId ?? 'parse-error', message: m.message });
      }
    }
    return issues;
  } catch {
    return null;
  }
}

async function runEslint(repo: string, files: string[]): Promise<Omit<ToolRun, 'lang' | 'langName' | 'tool' | 'files'>> {
  const win = process.platform === 'win32';
  const local = join(repo, 'node_modules', '.bin', win ? 'eslint.cmd' : 'eslint');
  const cmd = existsSync(local) ? local : 'eslint';
  const q = (s: string) => (win ? `"${s}"` : s);
  // Windows 上 eslint 是 .cmd，要透過 shell 才能執行。
  const exec = (args: string[], list: string[]) => (win ? run(q(cmd), [...args, ...list.map(q)], repo, true) : run(cmd, [...args, ...list], repo));
  const common = ['--format', 'json', '--no-error-on-unmatched-pattern'];

  const r = await exec(common, files);
  if (r.missing) return { status: 'missing', detail: INSTALL_HINT.js, issues: [] };
  const issues = parseEslint(repo, r.stdout);
  if (issues) return { status: 'ok', detail: '', issues };

  const noConfig = /eslint\.config|couldn't find|No ESLint configuration/i.test(r.stderr + r.stdout);
  if (!noConfig) return { status: 'error', detail: `eslint 執行失敗：${firstLine(r.stderr || r.stdout)}`, issues: [] };

  // 沒有設定檔：改用內建的基本規則。TypeScript 需要額外的解析器，這種情況下只能略過。
  const plain = files.filter((f) => /\.(js|jsx|mjs|cjs)$/i.test(f));
  if (plain.length === 0) return { status: 'error', detail: '這個專案沒有 eslint 設定檔（eslint.config.js），TypeScript 檔案無法檢查。', issues: [] };
  const r2 = await exec([...common, '--no-config-lookup', ...BASIC_RULES.flatMap((rule) => ['--rule', rule])], plain);
  const basic = parseEslint(repo, r2.stdout);
  if (!basic) return { status: 'error', detail: `eslint 執行失敗：${firstLine(r2.stderr || r2.stdout)}`, issues: [] };
  const skippedTs = files.length - plain.length;
  return { status: 'ok', detail: `專案沒有 eslint 設定檔，改用內建的基本規則${skippedTs ? `（${skippedTs} 個 TypeScript 檔案略過）` : ''}`, issues: basic };
}

const RUNNERS: Record<Lang, (repo: string, files: string[]) => Promise<Omit<ToolRun, 'lang' | 'langName' | 'tool' | 'files'>>> = {
  cpp: runCppcheck,
  python: runRuff,
  js: runEslint,
};

/** 依語言分組，各自呼叫對應的檢查工具。 */
export async function lintFiles(repo: string, files: string[]): Promise<ToolRun[]> {
  const groups = new Map<Lang, string[]>();
  for (const f of files) {
    const lang = langOf(f);
    if (lang) groups.set(lang, [...(groups.get(lang) ?? []), f]);
  }
  const runs: ToolRun[] = [];
  for (const [lang, list] of groups) {
    const r = await RUNNERS[lang](repo, list);
    runs.push({ lang, langName: LANG_NAMES[lang], tool: TOOL_OF[lang], files: list.length, ...r });
  }
  return runs;
}
