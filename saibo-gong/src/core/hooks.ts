// 安裝與移除 git 的 pre-push hook。
// hook 是一小段 shell 腳本（Windows 上由 Git 內建的 sh 執行），它呼叫 App 附的小程式去問主殿。
// 設計原則：hook 絕不能讓 push 卡死或誤擋。只有小程式明確回傳 1 才擋，其餘情況（App 被移除、出錯）一律放行。

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const HOOK_MARKER = '# saibo-gong-hook';

export interface HookPaths {
  exe: string; // Electron 執行檔
  cli: string; // dist/hook-client.js
}

export interface HookResult {
  ok: boolean;
  message: string;
}

const sh = (p: string) => `'${p.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`;
const norm = (p: string) => resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

const CALL = (p: HookPaths) => `EXE=${sh(p.exe)}
CLI=${sh(p.cli)}`;

export function repoHookScript(p: HookPaths): string {
  return `#!/bin/sh
${HOOK_MARKER} repo（賽博宮擲筊 push，由 App 產生，請勿手改）
${CALL(p)}
[ -f "$EXE" ] && [ -f "$CLI" ] || exit 0
ELECTRON_RUN_AS_NODE=1 "$EXE" "$CLI" pre-push "$@"
[ $? -eq 1 ] && exit 1
exit 0
`;
}

export function globalHookScript(p: HookPaths): string {
  return `#!/bin/sh
${HOOK_MARKER} global（賽博宮擲筊 push，由 App 產生，請勿手改）
${CALL(p)}
input=$(cat)
if [ -f "$EXE" ] && [ -f "$CLI" ]; then
  printf '%s\\n' "$input" | ELECTRON_RUN_AS_NODE=1 "$EXE" "$CLI" pre-push "$@"
  [ $? -eq 1 ] && exit 1
fi
# 全域 hook 會蓋過各 repo 自己的 hook，所以這裡接著執行 repo 原本的 pre-push。
h="$(git rev-parse --git-dir 2>/dev/null)/hooks/pre-push"
if [ -x "$h" ]; then
  printf '%s\\n' "$input" | "$h" "$@" || exit $?
fi
exit 0
`;
}

// 全域 hooksPath 會讓各 repo 的所有 hook 失效，所以其他種類的 hook 也放一個「轉交」腳本。
export const FORWARDED_HOOKS = [
  'applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit', 'pre-merge-commit', 'prepare-commit-msg',
  'commit-msg', 'post-commit', 'pre-rebase', 'post-checkout', 'post-merge', 'post-rewrite', 'pre-auto-gc',
  'sendemail-validate', 'post-index-change',
];

export function forwardScript(name: string): string {
  return `#!/bin/sh
${HOOK_MARKER} forward（轉交給 repo 自己的 ${name} hook）
h="$(git rev-parse --git-dir 2>/dev/null)/hooks/${name}"
[ -x "$h" ] && exec "$h" "$@"
exit 0
`;
}

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
}

function gitOrEmpty(args: string[], cwd?: string): string {
  try {
    return git(args, cwd);
  } catch {
    return '';
  }
}

export function gitAvailable(): boolean {
  try {
    git(['--version']);
    return true;
  } catch {
    return false;
  }
}

const isOurs = (file: string) => existsSync(file) && readFileSync(file, 'utf8').includes(HOOK_MARKER);

function writeHook(file: string, content: string): void {
  writeFileSync(file, content, { encoding: 'utf8' });
  try {
    chmodSync(file, 0o755);
  } catch {
    /* Windows 上沒有執行權限的概念 */
  }
}

export const globalHooksDir = (dataDir: string) => join(dataDir, 'hooks');

export function isGlobalInstalled(dataDir: string): boolean {
  const cur = gitOrEmpty(['config', '--global', '--get', 'core.hooksPath']);
  return !!cur && norm(cur) === norm(globalHooksDir(dataDir)) && isOurs(join(globalHooksDir(dataDir), 'pre-push'));
}

/** 找出 repo 的最上層資料夾；不是 git repo 就回傳 null。 */
export function repoRoot(dir: string): string | null {
  const top = gitOrEmpty(['rev-parse', '--show-toplevel'], dir);
  return top ? resolve(top) : null;
}

function repoHookFile(root: string): string {
  return resolve(root, git(['rev-parse', '--git-path', 'hooks'], root), 'pre-push');
}

export function isRepoInstalled(root: string): boolean {
  try {
    return !gitOrEmpty(['config', '--get', 'core.hooksPath'], root) && isOurs(repoHookFile(root));
  } catch {
    return false;
  }
}

export function installRepoHook(dir: string, p: HookPaths, dataDir: string): HookResult & { root?: string } {
  if (!gitAvailable()) return { ok: false, message: '找不到 git，請先安裝 Git。' };
  const root = repoRoot(dir);
  if (!root) return { ok: false, message: '這個資料夾不是 git repo。' };
  const hooksPath = gitOrEmpty(['config', '--get', 'core.hooksPath'], root);
  if (hooksPath) {
    if (norm(hooksPath) === norm(globalHooksDir(dataDir))) return { ok: false, message: '已經全域安裝了，這個 repo 不需要再個別安裝。' };
    return { ok: false, message: `這個 repo 設定了自己的 hook 資料夾（core.hooksPath = ${hooksPath}），為了不弄亂它，沒有安裝。` };
  }
  const file = repoHookFile(root);
  if (existsSync(file) && !isOurs(file)) return { ok: false, message: '這個 repo 已經有別的 pre-push hook，為了不蓋掉它，沒有安裝。' };
  mkdirSync(join(file, '..'), { recursive: true });
  writeHook(file, repoHookScript(p));
  return { ok: true, message: `已為 ${root} 安裝擲筊 push。`, root };
}

export function uninstallRepoHook(root: string): HookResult {
  try {
    const file = repoHookFile(root);
    if (isOurs(file)) unlinkSync(file);
    return { ok: true, message: `已從 ${root} 移除擲筊 push。` };
  } catch {
    return { ok: true, message: `${root} 已經不存在或不是 git repo，已從清單移除。` };
  }
}

export function installGlobalHook(p: HookPaths, dataDir: string): HookResult {
  if (!gitAvailable()) return { ok: false, message: '找不到 git，請先安裝 Git。' };
  const dir = globalHooksDir(dataDir);
  const cur = gitOrEmpty(['config', '--global', '--get', 'core.hooksPath']);
  if (cur && norm(cur) !== norm(dir)) return { ok: false, message: `你的 git 已經設定了全域 hook 資料夾（${cur}），為了不蓋掉它，沒有安裝。` };
  mkdirSync(dir, { recursive: true });
  writeHook(join(dir, 'pre-push'), globalHookScript(p));
  for (const name of FORWARDED_HOOKS) writeHook(join(dir, name), forwardScript(name));
  git(['config', '--global', 'core.hooksPath', dir.replace(/\\/g, '/')]);
  return { ok: true, message: '已全域安裝：這台電腦上所有 repo 的 push 都要先擲筊。' };
}

export function uninstallGlobalHook(dataDir: string): HookResult {
  const dir = globalHooksDir(dataDir);
  const cur = gitOrEmpty(['config', '--global', '--get', 'core.hooksPath']);
  if (cur && norm(cur) === norm(dir)) git(['config', '--global', '--unset', 'core.hooksPath']);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) if (isOurs(join(dir, f))) rmSync(join(dir, f));
  }
  return { ok: true, message: '已移除全域的擲筊 push。' };
}
