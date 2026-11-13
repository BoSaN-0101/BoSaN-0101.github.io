// 資料夾位置。主程式和 git hook 用的小程式都靠這裡決定，兩邊一定要一致。
// 資料夾名稱固定用英文，避免路徑編碼問題。SAIBO_DATA_DIR 只給開發測試用。

import { homedir } from 'node:os';
import { join } from 'node:path';

export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SAIBO_DATA_DIR) return env.SAIBO_DATA_DIR;
  if (process.platform === 'win32' && env.APPDATA) return join(env.APPDATA, 'DigitalTemple');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'DigitalTemple');
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'DigitalTemple');
}

export const serverFile = (dir: string) => join(dir, 'server.json');
