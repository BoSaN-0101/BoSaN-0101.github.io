// 變數姓名學：算識別字的筆畫，套八十一數理看吉凶。只建議、不擋。
// 中文字查真實筆畫（cnchar，MIT 授權）；英文字母和數字查一張可調整的對照表。

import cnchar from 'cnchar';
import trad from 'cnchar-trad';

cnchar.use(trad);

export type Luck = 'ji' | 'ban' | 'xiong';
export const LUCK_NAMES: Record<Luck, string> = { ji: '吉', ban: '半吉', xiong: '凶' };

export type StrokeTable = Record<string, number>;

// 民間通行的八十一數理：[吉凶, 四字斷語]
const J = 'ji';
const B = 'ban';
const X = 'xiong';
const TABLE: [Luck, string][] = [
  [J, '繁榮發達'], [X, '動搖不安'], [J, '立身出世'], [X, '萬事休止'], [J, '福祿長壽'], [J, '安穩吉慶'], [J, '剛毅果斷'], [J, '意志剛健'], [X, '興盡凶始'],
  [X, '萬事終局'], [J, '草木逢春'], [X, '薄弱無力'], [J, '智略超群'], [X, '淪落天涯'], [J, '福壽圓滿'], [J, '貴人得助'], [J, '突破萬難'], [J, '有志竟成'],
  [X, '風雲蔽月'], [X, '非業破運'], [J, '明月光照'], [X, '秋草逢霜'], [J, '旭日東昇'], [J, '家門餘慶'], [J, '資性英敏'], [X, '變怪奇異'], [B, '足智多謀'],
  [X, '遭難之數'], [J, '智謀優秀'], [B, '浮沉不定'], [J, '智勇得志'], [J, '僥倖多望'], [J, '家門隆昌'], [X, '破家之數'], [J, '溫和平安'], [X, '波瀾重疊'],
  [J, '權威顯達'], [B, '意志薄弱'], [J, '富貴榮華'], [B, '謹慎保安'], [J, '德高望重'], [B, '十藝不成'], [X, '散財破產'], [X, '愁眉難展'], [J, '順風揚帆'],
  [X, '載寶沉舟'], [J, '點石成金'], [J, '青松立鶴'], [X, '轉變無常'], [B, '小舟入海'], [B, '沉浮不常'], [J, '先見之明'], [B, '內憂外患'], [X, '多難悲運'],
  [B, '外美內苦'], [X, '暮日淒涼'], [J, '寒雪青松'], [B, '晚行遇月'], [X, '寒蟬悲風'], [X, '無謀黑暗'], [J, '名利雙收'], [X, '衰敗內外'], [J, '富貴榮達'],
  [X, '骨肉分離'], [J, '富貴長壽'], [X, '內外不和'], [J, '通達四方'], [J, '興家立業'], [X, '坐立不安'], [X, '慘淡空虛'], [B, '養神耐勞'], [X, '勞苦相伴'],
  [B, '志高力微'], [X, '沉淪逆境'], [B, '守則可安'], [X, '傾覆離散'], [B, '樂極生悲'], [B, '晚境淒涼'], [X, '挽回乏力'], [X, '遁世離塵'], [J, '還元復始'],
];

export interface NameReading {
  name: string;
  strokes: number; // 總筆畫
  number: number; // 化為 1–81 的數
  luck: Luck;
  label: string;
}

/** 超過 81 就減 80，直到落在 1–81。 */
export function reduce81(n: number): number {
  return n <= 81 ? n : ((n - 2) % 80) + 2;
}

export function luckOf(n: number): [Luck, string] {
  return TABLE[reduce81(n) - 1];
}

/** 算一個名字的筆畫。有查不到筆畫的字就回傳 null。 */
export function strokesOf(name: string, table: StrokeTable): number | null {
  let total = 0;
  let counted = 0;
  for (const ch of name) {
    if (ch === '_' || ch === '$') continue;
    const upper = ch.toUpperCase();
    if (typeof table[upper] === 'number') {
      total += table[upper];
    } else {
      const s = cnchar.stroke(ch);
      const n = Array.isArray(s) ? s[0] : s;
      if (!n) return null;
      total += n;
    }
    counted++;
  }
  return counted ? total : null;
}

export function readName(name: string, table: StrokeTable): NameReading | null {
  const strokes = strokesOf(name, table);
  if (strokes === null || strokes < 1) return null;
  const [luck, label] = luckOf(strokes);
  return { name, strokes, number: reduce81(strokes), luck, label };
}

const KEYWORDS = new Set(
  ('if else for while do switch case default break continue return goto try catch throw finally new delete this super null nullptr true false ' +
    'void bool char short int long float double auto signed unsigned const static inline extern volatile constexpr struct class enum union namespace ' +
    'template typename using typedef public private protected virtual override operator sizeof ' +
    'def lambda pass import from as with yield async await global nonlocal assert raise except in is not and or None True False self cls ' +
    'var let function export extends implements interface type typeof instanceof undefined main').split(' '),
);

const ID = '[A-Za-z_$\\u4e00-\\u9fff][\\w$\\u4e00-\\u9fff]*';
const C_TYPE =
  '(?:(?:const|static|unsigned|signed|inline|extern|volatile|constexpr)\\s+)*' +
  '(?:void|bool|char|short|int|long|float|double|auto|size_t|u?int\\d+_t|std::[\\w:]+(?:<[^;(){}]*>)?|[A-Z]\\w*(?:<[^;(){}]*>)?)';

const PATTERNS: Record<string, RegExp[]> = {
  cpp: [
    new RegExp(`\\b${C_TYPE}\\s*[*&]*\\s+[*&]*\\s*(${ID})\\s*(?=[=;,()\\[{])`, 'g'),
    new RegExp(`\\b(?:class|struct|enum|namespace|union)\\s+(${ID})`, 'g'),
    new RegExp(`^\\s*#\\s*define\\s+(${ID})`, 'g'),
  ],
  python: [
    new RegExp(`\\b(?:def|class)\\s+(${ID})`, 'g'),
    new RegExp(`^\\s*(${ID})\\s*(?::[^=]+)?=(?!=)`, 'g'),
    new RegExp(`\\bfor\\s+(${ID})\\s+in\\b`, 'g'),
  ],
  js: [
    new RegExp(`\\b(?:const|let|var|function\\*?|class|interface|type|enum)\\s+(${ID})`, 'g'),
    new RegExp(`^\\s*(?:async\\s+)?(${ID})\\s*\\([^)]*\\)\\s*\\{`, 'g'),
  ],
};

/** 從新增的程式碼行裡找出被宣告的識別字（變數、函式、類別名稱）。 */
export function declaredNames(lang: string, lines: string[]): string[] {
  const out = new Set<string>();
  for (const line of lines) {
    const code = line.replace(/\/\/.*$|#(?!\s*define).*$/, '');
    for (const re of PATTERNS[lang] ?? []) {
      re.lastIndex = 0;
      for (let m = re.exec(code); m; m = re.exec(code)) {
        if (!KEYWORDS.has(m[1]) && m[1].length > 0) out.add(m[1]);
      }
    }
  }
  return [...out];
}
