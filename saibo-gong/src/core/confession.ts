// 懺悔文：硬闖時要逐字打完。
// 有短、中、長三種長度（使用者在設定裡選），每種長度有甲、乙兩版，每次隨機出現一版。

export type ConfessionLength = 'short' | 'medium' | 'long';

export interface Confession {
  id: string;
  length: ConfessionLength;
  title: string;
  text: string;
}

export const CONFESSION_LENGTHS: { id: ConfessionLength; name: string; hint: string }[] = [
  { id: 'short', name: '短', hint: '約 35 字' },
  { id: 'medium', name: '中', hint: '約 80 字' },
  { id: 'long', name: '長', hint: '約 150 字' },
];

export const DEFAULT_CONFESSION_LENGTH: ConfessionLength = 'medium';

export const CONFESSIONS: Confession[] = [
  {
    id: 'jia-short',
    length: 'short',
    title: '甲・古風奏疏（短）',
    text: '弟子愚昧，明知神明不允，仍執意強行。若有差錯，皆弟子之過。伏請恕罪。',
  },
  {
    id: 'yi-short',
    length: 'short',
    title: '乙・工程師自白（短）',
    text: '我知道神明說不行，但我還是要硬推。出事我自己半夜爬起來修，不怪筊。',
  },
  {
    id: 'jia',
    length: 'medium',
    title: '甲・古風奏疏',
    text: '弟子愚昧，明知神明不允，仍執意強行。今日所推之程式，若有錯漏當機，皆弟子一人之過，與神明無涉。事後必補測試、補文件，並以綠色乖乖一包謝罪。伏請恕罪。',
  },
  {
    id: 'yi',
    length: 'medium',
    title: '乙・工程師自白',
    text: '我知道神明說不行，但我還是要硬推。我保證這不是因為趕時間，雖然其實就是因為趕時間。如果正式環境因此出事，我會自己半夜爬起來修，不怪筊、不怪農民曆、也不怪同事。',
  },
  {
    id: 'jia-long',
    length: 'long',
    title: '甲・古風奏疏（長）',
    text: '弟子愚昧，明知神明不允，仍執意強行。今日所推之程式，未經神明首肯，若有錯漏當機、資料毀損、客戶來電，皆弟子一人之過，與神明無涉，亦與同僚無干。弟子自知心浮氣躁，貪圖一時之快，有違工程之道。事後必補測試、補文件、補註解，三日之內不再硬闖，並以綠色乖乖一包、清香三炷謝罪。伏請神明息怒，恕弟子之罪。',
  },
  {
    id: 'yi-long',
    length: 'long',
    title: '乙・工程師自白（長）',
    text: '我知道神明說不行，但我還是要硬推。我保證這不是因為趕時間，雖然其實就是因為趕時間。我也知道測試沒跑完、文件沒更新、那個警告我看到了但選擇相信它不重要。如果正式環境因此出事，我會自己半夜爬起來修，自己寫事後檢討報告，自己跟主管解釋，不怪筊、不怪農民曆、不怪同事、也不怪星期五。下次我會乖乖等聖筊，大概吧。',
  },
];

export function isConfessionLength(v: unknown): v is ConfessionLength {
  return v === 'short' || v === 'medium' || v === 'long';
}

export function pickConfession(length: ConfessionLength = DEFAULT_CONFESSION_LENGTH, random: () => number = Math.random): Confession {
  const pool = CONFESSIONS.filter((c) => c.length === length);
  return pool[Math.floor(random() * pool.length) % pool.length];
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
