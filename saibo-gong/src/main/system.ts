// 和 Windows 打交道的部分：讀當機事件、列出執行中的程式、檔案總管右鍵選單。
// 全部透過 Windows 內建的 PowerShell 和 reg.exe，不需要另外安裝東西。
// 開發測試時可以用 SAIBO_FAKE_CRASHES / SAIBO_FAKE_PROCESSES 指到 JSON 檔來模擬。

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Crash } from '../core/shoujing.ts';
import type { Proc } from '../core/pudu.ts';

export const isWindows = process.platform === 'win32';

function run(cmd: string, args: string[], timeout = 30000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) }),
    );
  });
}

/** 執行一段 PowerShell，回傳它印出來的文字。用 -EncodedCommand 傳，避開命令列引號的各種陷阱。 */
export async function powershellText(script: string): Promise<string> {
  const full = `[Console]::OutputEncoding=[Text.Encoding]::UTF8\n$ErrorActionPreference='SilentlyContinue'\n$ProgressPreference='SilentlyContinue'\n${script}`;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
  return r.stdout;
}

async function powershell<T>(script: string, fallback: T): Promise<T> {
  const stdout = await powershellText(script);
  try {
    const text = stdout.trim();
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

function fake<T>(envName: string): T | null {
  const file = process.env[envName];
  if (!file) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** 最近一段時間內的應用程式當機事件（Windows 事件記錄，Application Error，事件 1000）。 */
export async function listCrashes(minutes: number): Promise<Crash[]> {
  const faked = fake<Crash[]>('SAIBO_FAKE_CRASHES');
  if (faked) return faked;
  if (!isWindows) return [];
  const script = `
$since=(Get-Date).AddMinutes(-${Math.max(1, Math.floor(minutes))})
$ev=Get-WinEvent -FilterHashtable @{LogName='Application';ProviderName='Application Error';Id=1000;StartTime=$since}
$out=@($ev | ForEach-Object { $p=$_.Properties; [pscustomobject]@{ time=$_.TimeCreated.ToUniversalTime().ToString('o'); name=[string]$p[0].Value; module=[string]$p[3].Value; code=[string]$p[6].Value; path=[string]$p[10].Value } })
ConvertTo-Json -InputObject $out -Compress`;
  const list = await powershell<Crash[] | Crash>(script, []);
  return Array.isArray(list) ? list : [list];
}

/** 目前執行中的程式。 */
export async function listProcesses(): Promise<Proc[]> {
  const faked = fake<Proc[]>('SAIBO_FAKE_PROCESSES');
  if (faked) return faked;
  if (!isWindows) return [];
  const script = `
$svc=@{}; Get-CimInstance Win32_Service | Where-Object {$_.ProcessId -gt 0} | ForEach-Object { $svc[[int]$_.ProcessId]=$true }
$me=(Get-Process -Id $PID).SessionId
$out=@(Get-Process | ForEach-Object {
  $path=$null; $start=$null; $cpu=$null
  try{$path=$_.Path}catch{}
  try{$start=$_.StartTime.ToUniversalTime().ToString('o')}catch{}
  try{$cpu=$_.TotalProcessorTime.TotalSeconds}catch{}
  [pscustomobject]@{pid=$_.Id;name=$_.ProcessName;path=$path;mySession=($_.SessionId -eq $me);hasWindow=($_.MainWindowHandle -ne 0);title=[string]$_.MainWindowTitle;responding=[bool]$_.Responding;start=$start;cpu=$cpu;service=$svc.ContainsKey([int]$_.Id)}
})
ConvertTo-Json -InputObject $out -Compress`;
  const list = await powershell<Proc[] | Proc>(script, []);
  return Array.isArray(list) ? list : [list];
}

// ───── 檔案總管右鍵選單「燒給它」 ─────
// 寫在目前使用者的登錄檔（HKCU），不需要系統管理員權限，移除後不留痕跡。

const MENU_KEYS = ['HKCU\\Software\\Classes\\*\\shell\\SaiboGongBurn', 'HKCU\\Software\\Classes\\Directory\\shell\\SaiboGongBurn'];

export async function contextMenuInstalled(): Promise<boolean> {
  if (!isWindows) return false;
  return (await run('reg.exe', ['query', MENU_KEYS[0]])).ok;
}

export async function installContextMenu(command: string, icon: string): Promise<{ ok: boolean; message: string }> {
  if (!isWindows) return { ok: false, message: '右鍵選單只能在 Windows 上安裝。' };
  for (const key of MENU_KEYS) {
    const steps = [
      ['add', key, '/ve', '/d', '燒給它', '/f'],
      ['add', key, '/v', 'Icon', '/d', icon, '/f'],
      ['add', `${key}\\command`, '/ve', '/d', command, '/f'],
    ];
    for (const args of steps) {
      const r = await run('reg.exe', args);
      if (!r.ok) return { ok: false, message: `寫入登錄檔失敗：${r.stderr.trim().split('\n')[0]}` };
    }
  }
  return { ok: true, message: '已在檔案總管的右鍵選單加上「燒給它」。（Windows 11 要先點「顯示其他選項」才看得到）' };
}

export async function uninstallContextMenu(): Promise<{ ok: boolean; message: string }> {
  if (!isWindows) return { ok: false, message: '右鍵選單只能在 Windows 上安裝。' };
  for (const key of MENU_KEYS) await run('reg.exe', ['delete', key, '/f']);
  return { ok: true, message: '已移除右鍵選單的「燒給它」。' };
}
