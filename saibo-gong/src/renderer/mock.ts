// 在一般瀏覽器裡直接開畫面時用的替身（開發與截圖檢查用），資料只存在記憶體裡。
// 正式執行時 window.temple 由 preload 提供，不會用到這個檔案的內容。

import { throwPoe } from '../core/poe.ts';
import { pickConfession, type ConfessionLength } from '../core/confession.ts';
import { getAlmanac } from '../core/almanac.ts';
import type { TempleApi, TempleState } from '../shared/api.ts';
import type { LedgerEntry } from '../core/ledger.ts';

export function createMock(): TempleApi {
  const q = new URLSearchParams(location.search);
  const entries: LedgerEntry[] = [];
  const add = (action: string, target: string, confession = '') =>
    entries.push({ seq: entries.length + 1, time: new Date().toISOString(), feature: '主殿', action, target, confession, prevHash: '', hash: '' });
  if (q.has('seed')) { add('閉廟', '全部功能'); add('硬闖', 'demo/repo', '弟子愚昧……'); }
  const stats = { throws: 0, sheng: 0, xiao: 0, yin: 0, pushes: 0, pushBlessed: 0, pushDefied: 0, pushAbandoned: 0, pushAbsent: 0 };
  let closed = q.has('closed');
  let confessionLength: ConfessionLength = 'medium';
  let confessionHintShown = false;
  let listener: ((s: TempleState) => void) | null = null;
  const state = (): TempleState => ({
    closed,
    tampered: q.has('tampered'),
    tamperReason: q.has('tampered') ? '第 2 筆的內容被改過' : undefined,
    ledgerCount: entries.length,
    recentLedger: entries.slice(-5).reverse(),
    stats: { ...stats },
    features: [
      { id: 'poePush', name: '擲筊 push', desc: 'git push 前先擲筊，三次為限', stage: 'M2', available: false, enabled: false },
      { id: 'guaiguai', name: '綠色乖乖', desc: '過期會不乖（效果皆可還原）', stage: 'M5', available: false, enabled: false },
    ],
    dataDir: '（瀏覽器預覽，不存檔）',
    confessionLength,
    confessionHintShown,
    almanac: getAlmanac(q.has('ji') ? new Date(2026, 10, 14) : new Date()),
    protectedBranches: ['main', 'master'],
  });
  const emit = () => { const s = state(); listener?.(s); return s; };
  const forced = q.get('force');
  return {
    getState: async () => state(),
    throwPoe: async () => {
      const t = forced === 'no' ? { faces: ['round', 'round'] as ['round', 'round'], result: 'yin' as const } : throwPoe();
      stats.throws++; stats[t.result]++; emit();
      return t;
    },
    getLedger: async () => ({ ok: !q.has('tampered'), reason: state().tamperReason, brokenAt: q.has('tampered') ? 2 : undefined, entries }),
    closeTemple: async () => { if (!closed) { closed = true; add('閉廟', '全部功能'); } return emit(); },
    openTemple: async () => { closed = false; return emit(); },
    setFeature: async () => emit(),
    pickConfession: async () => pickConfession(confessionLength),
    setConfessionLength: async (l) => { confessionLength = l; return emit(); },
    markConfessionHintShown: async () => { confessionHintShown = true; return emit(); },
    setProtectedBranches: async () => emit(),
    getHookStatus: async () => ({ gitAvailable: true, global: false, repos: q.has('seed') ? [{ path: 'C:/work/demo', installed: true }] : [] }),
    chooseFolder: async () => null,
    installRepoHook: async () => ({ ok: true, message: '（預覽）' }),
    uninstallRepoHook: async () => ({ ok: true, message: '（預覽）' }),
    installGlobalHook: async () => ({ ok: true, message: '（預覽）' }),
    uninstallGlobalHook: async () => ({ ok: true, message: '（預覽）' }),
    pullRitual: async () =>
      q.has('ritual') ? { id: 'demo', repo: 'demo', refs: 'main', almanacBlock: q.has('ji') ? '今日忌開市，不宜正式上線（分支 main）' : null, poe: true, maxThrows: 3 } : null,
    finishRitual: async () => {},
    onRitualStart: () => {},
    onRitualCancel: () => {},
    onStateChanged: (cb) => { listener = cb; },
  };
}
