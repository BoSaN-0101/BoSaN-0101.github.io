// 擲筊引擎：結果由亂數決定，動畫只是演出。
// 每個筊各自獨立，朝上的那一面是「平」或「凸」，機率各半，
// 所以聖筊（一平一凸）1/2、笑筊（兩平）1/4、陰筊（兩凸）1/4。

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

export type RandomBit = () => 0 | 1;

export const cryptoBit: RandomBit = () => {
  const buf = new Uint8Array(1);
  globalThis.crypto.getRandomValues(buf);
  return (buf[0] & 1) as 0 | 1;
};

export function judge(faces: [PoeFace, PoeFace]): PoeResult {
  if (faces[0] !== faces[1]) return 'sheng';
  return faces[0] === 'flat' ? 'xiao' : 'yin';
}

/** 擲一次，回傳結果。 */
export function throwPoe(bit: RandomBit = cryptoBit): PoeThrow {
  const faces: [PoeFace, PoeFace] = [bit() ? 'flat' : 'round', bit() ? 'flat' : 'round'];
  return { faces, result: judge(faces) };
}
