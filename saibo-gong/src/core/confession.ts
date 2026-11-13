// 懺悔文：硬闖時要逐字打完。甲、乙兩版每次隨機出現一版。

export interface Confession {
  id: string;
  title: string;
  text: string;
}

export const CONFESSIONS: Confession[] = [
  {
    id: 'jia',
    title: '甲・古風奏疏',
    text: '弟子愚昧，明知神明不允，仍執意強行。今日所推之程式，若有錯漏當機，皆弟子一人之過，與神明無涉。事後必補測試、補文件，並以綠色乖乖一包謝罪。伏請恕罪。',
  },
  {
    id: 'yi',
    title: '乙・工程師自白',
    text: '我知道神明說不行，但我還是要硬推。我保證這不是因為趕時間，雖然其實就是因為趕時間。如果正式環境因此出事，我會自己半夜爬起來修，不怪筊、不怪農民曆、也不怪同事。',
  },
];

export function pickConfession(random: () => number = Math.random): Confession {
  return CONFESSIONS[Math.floor(random() * CONFESSIONS.length) % CONFESSIONS.length];
}

export function getConfession(id: string): Confession | undefined {
  return CONFESSIONS.find((c) => c.id === id);
}

/** 換行和頭尾空白不算，其餘（含標點）必須逐字相同。 */
export function normalizeTyped(typed: string): string {
  return typed.replace(/[\r\n]/g, '').trim();
}

export function isConfessionComplete(id: string, typed: string): boolean {
  const c = getConfession(id);
  return !!c && normalizeTyped(typed) === c.text;
}

/** 回傳從開頭算起連續打對了幾個字，UI 用來標示第一個錯字的位置。 */
export function correctPrefixLength(text: string, typed: string): number {
  const t = normalizeTyped(typed);
  let i = 0;
  while (i < t.length && i < text.length && t[i] === text[i]) i++;
  return i;
}
