// 農民曆宜忌：用離線的 lunar-javascript（6tail，MIT 授權）計算，不需要網路。
// 函式庫輸出的是簡體字，這裡轉成繁體。

import { Solar } from 'lunar-javascript';

export interface Almanac {
  date: string; // 國曆 YYYY-MM-DD
  lunar: string; // 例如「丙午年（馬）十月初五」
  yi: string[]; // 宜
  ji: string[]; // 忌
  jiKaishi: boolean; // 今日忌開市 → 不宜正式上線
}

const S2T: Record<string, string> = {
  进: '進', 殓: '殮', 谢: '謝', 启: '啟', 钻: '鑽', 坟: '墳', 斋: '齋', 动: '動', 纳: '納', 订: '訂', 车: '車', 庙: '廟',
  归: '歸', 宁: '寧', 学: '學', 医: '醫', 竖: '豎', 盖: '蓋', 门: '門', 丧: '喪', 开: '開', 会: '會', 亲: '親', 机: '機',
  涂: '塗', 馀: '餘', 桥: '橋', 产: '產', 绘: '繪', 坏: '壞', 诸: '諸', 猎: '獵', 财: '財', 仓: '倉', 帐: '帳', 经: '經',
  络: '絡', 扫: '掃', 马: '馬', 无: '無', 挂: '掛', 补: '補', 渔: '漁', 饰: '飾', 墙: '牆', 养: '養', 厕: '廁', 发: '髮',
  针: '針', 种: '種', 货: '貨', 词: '詞', 讼: '訟', 结: '結', 网: '網', 佣: '傭', 寿: '壽', 习: '習', 艺: '藝', 筑: '築', 问: '問',
  断: '斷', 蚁: '蟻', 龙: '龍', 鸡: '雞', 猪: '豬', 闰: '閏', 腊: '臘',
};

export function toTraditional(s: string): string {
  return Array.from(s, (c) => S2T[c] ?? c).join('');
}

const KAISHI = '開市';

export function parseDate(text: string): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getAlmanac(day: Date = new Date()): Almanac {
  const y = day.getFullYear();
  const m = day.getMonth() + 1;
  const d = day.getDate();
  const lunar = Solar.fromYmd(y, m, d).getLunar();
  const clean = (list: string[]) => list.map(toTraditional).filter((t) => t && t !== '無');
  const yi = clean(lunar.getDayYi());
  const ji = clean(lunar.getDayJi());
  return {
    date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    lunar: toTraditional(`${lunar.getYearInGanZhi()}年（${lunar.getYearShengXiao()}）${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`),
    yi,
    ji,
    // 「諸事不宜」的日子當然也不宜開市。
    jiKaishi: ji.includes(KAISHI) || ji.includes('諸事不宜'),
  };
}
