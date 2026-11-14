// 收驚：同一個程式在一段時間內當掉太多次，就判定「被嚇到了」。

export interface Crash {
  time: string; // ISO 8601
  name: string; // 例如 notepad.exe
  module: string; // 出事的模組
  code: string; // 例外代碼
  path: string; // 程式的完整路徑（可能是空的）
}

export interface Scared {
  name: string;
  path: string;
  count: number;
  lastTime: string;
  module: string;
  code: string;
  key: string; // 用來記住「這一批已經收過驚了」
}

export const SCARE_WINDOW_MS = 60 * 60 * 1000;
export const SCARE_THRESHOLD = 3;

/** 找出被嚇到的程式。handled 是已經收過驚的 key。 */
export function findScared(crashes: Crash[], now: Date, handled: string[] = [], windowMs = SCARE_WINDOW_MS, threshold = SCARE_THRESHOLD): Scared[] {
  const groups = new Map<string, Crash[]>();
  for (const c of crashes) {
    const t = new Date(c.time).getTime();
    if (!c.name || Number.isNaN(t) || now.getTime() - t > windowMs || t > now.getTime() + 60000) continue;
    const k = c.name.toLowerCase();
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const out: Scared[] = [];
  for (const [k, list] of groups) {
    if (list.length < threshold) continue;
    list.sort((a, b) => a.time.localeCompare(b.time));
    const last = list[list.length - 1];
    const key = `${k}@${last.time}`;
    if (handled.includes(key)) continue;
    out.push({ name: last.name, path: list.map((c) => c.path).filter(Boolean).pop() ?? '', count: list.length, lastTime: last.time, module: last.module, code: last.code, key });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** 收驚文（本專案自行創作）。 */
export function shoujingText(name: string): string[] {
  return [
    '天清清，地靈靈，',
    '香煙裊裊通神明。',
    `${name} 受驚魂未定，`,
    '三魂七魄四散行。',
    '一收記憶莫洩漏，',
    '二收指標莫懸空，',
    '三收例外有人接，',
    '魂歸本位各安寧。',
    '收驚收驚，當機不再，',
    '重開之後，一路太平。',
  ];
}
