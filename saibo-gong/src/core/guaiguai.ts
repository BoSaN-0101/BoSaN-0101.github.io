// 綠色乖乖：從包裝照片讀出有效日期、檢查是不是綠色的，並算出還剩幾天。

/** 從辨識出來的文字裡找日期。包裝上通常同時有製造日期和有效日期，取最晚的那個。 */
export function parseExpiry(text: string): string | null {
  const found: string[] = [];
  const add = (y: number, m: number, d: number) => {
    if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return;
    const dt = new Date(y, m - 1, d);
    if (dt.getMonth() !== m - 1) return; // 例如 2 月 30 日
    found.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  };
  for (const m of text.matchAll(/(20\d{2})\s*[.\/\-年]\s*(\d{1,2})\s*[.\/\-月]\s*(\d{1,2})/g)) add(+m[1], +m[2], +m[3]);
  for (const m of text.matchAll(/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/g)) add(+m[1], +m[2], +m[3]);
  return found.sort().pop() ?? null;
}

export function isValidDate(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && parseExpiry(text) === text;
}

export interface ColorCheck {
  green: boolean;
  greenShare: number; // 有顏色的部分裡，綠色佔多少
  dominant: string; // 最多的顏色
}

const HUES: [string, number, number][] = [
  ['紅色', 345, 20], ['橘色', 20, 45], ['黃色', 45, 75], ['綠色', 75, 165], ['青色', 165, 200], ['藍色', 200, 260], ['紫色', 260, 345],
];

/** 看照片中央的主色是不是綠色。data 是 RGBA 像素。其他口味不算。 */
export function checkGreen(data: Uint8ClampedArray | Uint8Array, width: number, height: number): ColorCheck {
  const counts = new Map<string, number>();
  let colored = 0;
  const x0 = Math.floor(width * 0.15), x1 = Math.ceil(width * 0.85);
  const y0 = Math.floor(height * 0.15), y1 = Math.ceil(height * 0.85);
  const step = Math.max(1, Math.floor(Math.min(width, height) / 200));
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const delta = max - min;
      if (max < 0.2 || delta / (max || 1) < 0.3) continue; // 太暗或太灰白的不算顏色
      let h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
      h = (h * 60 + 360) % 360;
      const name = HUES.find(([, a, z]) => (a < z ? h >= a && h < z : h >= a || h < z))![0];
      counts.set(name, (counts.get(name) ?? 0) + 1);
      colored++;
    }
  }
  if (colored === 0) return { green: false, greenShare: 0, dominant: '沒有顏色' };
  const dominant = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const greenShare = (counts.get('綠色') ?? 0) / colored;
  return { green: dominant === '綠色' && greenShare >= 0.35, greenShare: Math.round(greenShare * 100) / 100, dominant };
}

export interface GuaiguaiStatus {
  registered: boolean;
  expiry: string;
  daysLeft: number; // 負數表示已經過期幾天
  expired: boolean;
}

/** 有效日期當天還算有效，隔天起才算過期。 */
export function guaiguaiStatus(expiry: string, today: Date): GuaiguaiStatus {
  if (!isValidDate(expiry)) return { registered: false, expiry: '', daysLeft: 0, expired: false };
  const [y, m, d] = expiry.split('-').map(Number);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const daysLeft = Math.round((new Date(y, m - 1, d).getTime() - t) / 86400000);
  return { registered: true, expiry, daysLeft, expired: daysLeft < 0 };
}
