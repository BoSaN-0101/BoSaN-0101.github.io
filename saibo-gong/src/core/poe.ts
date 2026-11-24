// 擲筊引擎：結果由亂數決定，動畫只是演出。
// 機率可調：聖筊（一平一凸）SHENG_CHANCE，其餘由笑筊（兩平）和陰筊（兩凸）平分。

export type PoeFace = 'flat' | 'round';
export type PoeResult = 'sheng' | 'xiao' | 'yin';

export interface PoeThrow {
  faces: [PoeFace, PoeFace];
  result: PoeResult;
}

export const POE_NAMES: Record<PoeResult, string> = {
  sheng: '聖筊',
  xiao: '笑筊',
  yin: '陰筊',
};

/** 擲出聖筊的機率。真實的筊是 1/2，這裡調低一點，讓神明比較常說不。 */
export const SHENG_CHANCE = 0.4;

/** 回傳 [0, 1) 的亂數。 */
export type Random = () => number;

export const cryptoRandom: Random = () => {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
};

export function judge(faces: [PoeFace, PoeFace]): PoeResult {
  if (faces[0] !== faces[1]) return 'sheng';
  return faces[0] === 'flat' ? 'xiao' : 'yin';
}

/** 擲一次，回傳結果。 */
export function throwPoe(random: Random = cryptoRandom): PoeThrow {
  const r = random();
  let faces: [PoeFace, PoeFace];
  if (r < SHENG_CHANCE) faces = random() < 0.5 ? ['flat', 'round'] : ['round', 'flat'];
  else if (r < SHENG_CHANCE + (1 - SHENG_CHANCE) / 2) faces = ['flat', 'flat'];
  else faces = ['round', 'round'];
  return { faces, result: judge(faces) };
}
