// 綠色乖乖「不乖」效果裡會碰到桌面的部分：讀寫桌布、讓游標抖一下。
// 只在 Windows 上運作（透過內建的 PowerShell 呼叫系統 API）。
// 開發測試時設 SAIBO_FAKE_DESKTOP 指到一個資料夾，就改成讀寫那個資料夾裡的檔案來模擬。

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { powershellText, isWindows } from './system.ts';

const fakeDir = process.env.SAIBO_FAKE_DESKTOP;
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export const desktopSupported = isWindows || !!fakeDir;

/** 目前桌布的檔案路徑。純色、幻燈片等沒有固定檔案的情況回傳空字串。 */
export async function getWallpaper(): Promise<string> {
  if (fakeDir) {
    const f = join(fakeDir, 'wallpaper.txt');
    return existsSync(f) ? readFileSync(f, 'utf8').trim() : '';
  }
  if (!isWindows) return '';
  return (await powershellText(`(Get-ItemProperty 'HKCU:\\Control Panel\\Desktop').WallPaper`)).trim();
}

export async function setWallpaper(path: string): Promise<boolean> {
  if (fakeDir) {
    writeFileSync(join(fakeDir, 'wallpaper.txt'), path, 'utf8');
    return true;
  }
  if (!isWindows) return false;
  const script = `
Add-Type @"
using System.Runtime.InteropServices;
public class SaiboWp { [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int SystemParametersInfo(int a, int b, string c, int d); }
"@
[SaiboWp]::SystemParametersInfo(20, 0, ${psQuote(path)}, 3)`;
  return (await powershellText(script)).trim() === '1';
}

/** 讓游標往旁邊抖一下再回來。使用者正按著滑鼠鍵（例如拖曳中）就不抖。 */
export async function jitterCursor(dx: number, dy: number): Promise<void> {
  if (fakeDir) {
    appendFileSync(join(fakeDir, 'cursor.log'), `${dx},${dy}\n`, 'utf8');
    return;
  }
  if (!isWindows) return;
  const script = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class SaiboCur {
  [StructLayout(LayoutKind.Sequential)] public struct P { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);
}
"@
if ((([SaiboCur]::GetAsyncKeyState(1) -band 0x8000) -eq 0) -and (([SaiboCur]::GetAsyncKeyState(2) -band 0x8000) -eq 0)) {
  $p = New-Object SaiboCur+P
  [void][SaiboCur]::GetCursorPos([ref]$p)
  [void][SaiboCur]::SetCursorPos($p.X + ${dx}, $p.Y + ${dy}); Start-Sleep -Milliseconds 70
  [void][SaiboCur]::SetCursorPos($p.X - ${dx}, $p.Y); Start-Sleep -Milliseconds 70
  [void][SaiboCur]::SetCursorPos($p.X, $p.Y)
}`;
  await powershellText(script);
}
