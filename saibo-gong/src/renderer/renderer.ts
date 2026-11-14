import { PoeStage } from './poe-stage.ts';
import { createMock } from './mock.ts';
import { POE_NAMES, type PoeResult, type PoeThrow } from '../core/poe.ts';
import { CONFESSION_LENGTHS, correctPrefixLength, normalizeTyped } from '../core/confession.ts';
import type { ConfessionPrompt, Defiance, RitualRequest, SoulView, TempleApi, TempleState } from '../shared/api.ts';
import { shoujingText, type Scared } from '../core/shoujing.ts';
import type { Ghost } from '../core/pudu.ts';
import type { FortuneReport } from '../core/fortune.ts';
import { SEVERITY_NAMES } from '../core/fortune-names.ts';
import type { LedgerEntry } from '../core/ledger.ts';

declare global {
  interface Window { temple?: TempleApi }
}

const api: TempleApi = window.temple ?? createMock();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

const RESULT_DESC: Record<PoeResult, string> = {
  sheng: '一平一凸，神明准了',
  xiao: '兩面皆平，神明笑而不答',
  yin: '兩面皆凸，神明不准',
};

// ───────── 主殿狀態 ─────────

let state: TempleState;

function render(s: TempleState): void {
  state = s;
  const status = $('status');
  status.textContent = s.tampered ? '功過簿遭竄改' : s.closed ? '閉廟中' : '開廟中';
  status.className = 'pill' + (s.tampered ? ' bad' : s.closed ? ' closed' : '');

  const closeBtn = $<HTMLButtonElement>('btn-close-temple');
  closeBtn.textContent = s.closed ? '開廟' : '閉廟';
  closeBtn.classList.toggle('danger', !s.closed);
  closeBtn.title = s.closed ? '恢復所有功能。' : '一鍵暫停所有功能。閉廟會記入功過簿。';

  $('tamper').hidden = !s.tampered;
  $('tamper-reason').textContent = s.tamperReason ? `：${s.tamperReason}` : '';

  $('closed-veil').hidden = !s.closed;
  if (s.closed) { $('hint').hidden = true; $('result').hidden = true; }

  // 農民曆
  const [y, m, d] = s.almanac.date.split('-').map(Number);
  $('today').textContent = new Date(y, m - 1, d).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  $('lunar').textContent = `農曆 ${s.almanac.lunar}`;
  // 農民曆對 push 的實際影響，一句話講清楚。
  const almanacOn = s.features.some((f) => f.id === 'almanac' && f.enabled) && !s.closed;
  const kaishi = $('kaishi');
  const targets = `${s.protectedBranches.join('、')} 或 tag`;
  kaishi.className = 'badge' + (s.almanac.jiKaishi ? '' : ' calm');
  kaishi.textContent = s.almanac.jiKaishi
    ? almanacOn ? `今日忌開市：push 到 ${targets} 會被擋` : '今日忌開市（農民曆宜忌未啟用，不擋）'
    : `今日不忌開市：push 到 ${targets} 不受農民曆阻擋`;
  for (const [id, list] of [['yi', s.almanac.yi], ['ji', s.almanac.ji]] as const) {
    const dd = $(id);
    dd.replaceChildren();
    if (list.length === 0) dd.textContent = '—';
    list.forEach((t, i) => {
      if (i) dd.append('、');
      dd.append(t === '開市' || t === '諸事不宜' ? el('span', t, 'hit') : t);
    });
  }

  const stats = $('stats');
  stats.replaceChildren();
  for (const [label, n] of [['共擲', s.stats.throws], ['聖筊', s.stats.sheng], ['笑筊', s.stats.xiao], ['陰筊', s.stats.yin]] as const) {
    const cell = el('div');
    cell.append(el('b', String(n)), el('span', label));
    stats.append(cell);
  }
  $('push-stats').textContent = s.stats.pushes
    ? `push ${s.stats.pushes} 次：聖筊放行 ${s.stats.pushBlessed}、硬闖 ${s.stats.pushDefied}、作罷 ${s.stats.pushAbandoned}、神明不在 ${s.stats.pushAbsent}`
    : '';

  const recent = $('recent');
  recent.replaceChildren();
  if (s.recentLedger.length === 0) recent.append(el('li', '功過簿上還是一片空白。', 'muted'));
  for (const e of s.recentLedger) {
    const li = el('li');
    li.append(el('time', fmtTime(e.time)), document.createTextNode(`${e.feature}・${e.action}：${e.target}`));
    recent.append(li);
  }

  const seg = $('confess-length');
  seg.replaceChildren();
  for (const l of CONFESSION_LENGTHS) {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(s.confessionLength === l.id));
    b.append(document.createTextNode(l.name), el('small', l.hint));
    b.addEventListener('click', () => void api.setConfessionLength(l.id).then(render));
    seg.append(b);
  }

  // 籤詩：可選的 repo
  const sel = $<HTMLSelectElement>('fortune-repo');
  const keep = sel.value;
  sel.replaceChildren();
  for (const p of s.fortuneRepos) {
    const o = el('option', p);
    o.value = p;
    sel.append(o);
  }
  const other = el('option', '選擇其他資料夾…');
  other.value = '';
  sel.append(other);
  if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
  $<HTMLInputElement>('auto-fortune').checked = s.autoFortune;
  const fortuneOn = s.features.some((f) => f.id === 'fortune' && f.enabled) && !s.closed;
  $<HTMLButtonElement>('btn-fortune').disabled = !fortuneOn;
  $<HTMLInputElement>('auto-fortune').disabled = !fortuneOn;

  renderUnderworld(s);
  renderShoujing(s);
  renderPudu(s);

  const prot = $<HTMLInputElement>('protected');
  if (document.activeElement !== prot) prot.value = s.protectedBranches.join(', ');

  const feats = $('features');
  feats.replaceChildren();
  for (const f of s.features) {
    const li = el('li', '', f.available ? '' : 'off');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = f.enabled;
    box.disabled = !f.available || s.closed;
    box.setAttribute('aria-label', f.name);
    box.addEventListener('change', () => void api.setFeature(f.id, box.checked).then(render));
    const txt = el('div');
    txt.append(el('div', f.name, 'name'), el('div', f.desc, 'desc'));
    li.append(box, txt, el('span', '', 'spacer'));
    if (!f.available) li.append(el('span', `${f.stage} 開光`, 'tag'));
    feats.append(li);
  }
  updateControls();
}

// ───────── 擲筊與儀式 ─────────
// 「儀式」是照 push 的規矩走：（忌開市先擋）→ 擲筊最多三次 → 擲不到可硬闖或作罷。
// req 為 null 是演練，不會通知主程序、也不記功過簿。

interface Ritual {
  req: RitualRequest | null;
  revive?: SoulView; // 請回陽間：擲到聖筊才還原，不限次數
  phase: 'almanac' | 'poe' | 'done';
  used: number;
  max: number;
  almanacDefied?: Defiance;
}

const stage = new PoeStage($<HTMLCanvasElement>('poe'));
let ritual: Ritual | null = null;

function showResult(name: string, desc: string, bad: boolean): void {
  $('result-name').textContent = name;
  $('result-desc').textContent = desc;
  $('result').classList.toggle('no', bad);
  $('result').hidden = false;
}

function updateControls(): void {
  const closed = !!state?.closed;
  const label = $('mode-label');
  const auto = $<HTMLButtonElement>('btn-auto');
  const defy = $('btn-defy');
  const giveup = $('btn-giveup');
  const drillBtn = $<HTMLButtonElement>('btn-drill');
  const banner = $('ritual-banner');
  const r = ritual;
  const left = r ? r.max - r.used : 0;

  banner.hidden = !r?.req && !r?.revive;
  if (r?.revive) banner.replaceChildren('請回陽間：', el('b', r.revive.name), '　擲到聖筊才能還原');
  defy.textContent = r?.revive ? '強制還陽' : '硬闖';
  if (r?.req) {
    banner.replaceChildren('git push 求神明准許：', el('b', `${r.req.repo} → ${r.req.refs}`));
    // push 前自動抽的籤，放在這裡隨時可看，不打斷擲筊。
    if (lastFortune && lastFortune.repo === r.req.repo) {
      const b = el('button', `看籤（${fortuneSummary(lastFortune)}）`, 'link');
      b.addEventListener('click', () => showFortune(lastFortune!));
      banner.append('　', b);
    }
  }

  stage.enabled = !closed && (!r || (r.phase === 'poe' && (left > 0 || !!r.revive)));
  auto.disabled = closed;
  drillBtn.disabled = closed;
  drillBtn.hidden = !!r?.req || !!r?.revive;
  drillBtn.textContent = r ? '結束演練' : '演練 push 儀式';

  if (!r) {
    label.textContent = '問事（不限次數）';
    auto.hidden = false;
    auto.textContent = '代為擲筊';
    defy.hidden = true;
    giveup.hidden = true;
    return;
  }
  if (r.revive) {
    const live = r.phase !== 'done';
    label.textContent = live ? `請回陽間：第 ${r.used + 1} 擲` : '還陽儀式結束';
    auto.hidden = !live;
    auto.textContent = r.used === 0 ? '代為擲筊' : '再擲一次';
    defy.hidden = !live;
    giveup.hidden = !live;
    return;
  }
  const real = !!r.req;
  const name = real ? 'push' : '演練 push';
  if (r.phase === 'almanac') {
    label.textContent = `${name}：今日忌開市`;
    auto.hidden = true;
    defy.hidden = false;
    giveup.hidden = !real;
  } else if (r.phase === 'poe') {
    label.textContent = left > 0 ? `${name}：第 ${r.used + 1} / ${r.max} 擲` : `${name}：三次用完，神明不准`;
    auto.hidden = left === 0;
    auto.textContent = r.used === 0 ? '代為擲筊' : '再擲一次';
    defy.hidden = left > 0; // 三次都擲完才有硬闖這條路
    giveup.hidden = !real;
  } else {
    label.textContent = real ? 'push 儀式結束' : '演練結束';
    auto.hidden = true;
    defy.hidden = true;
    giveup.hidden = true;
  }
}

function startRitual(req: RitualRequest | null): void {
  ritual = { req, phase: req?.almanacBlock ? 'almanac' : 'poe', used: 0, max: req?.maxThrows ?? 3 };
  $('toast').hidden = true;
  stage.reset();
  if (req?.almanacBlock) {
    $('hint').hidden = true;
    showResult('忌開市', req.almanacBlock, true);
  } else {
    $('result').hidden = true;
    $('hint').hidden = false;
  }
  updateControls();
}

/** 儀式有了結果。正式的 push 要回報主程序。 */
function endRitual(allow: boolean, blessed: boolean, poeDefied?: Defiance): void {
  const r = ritual;
  if (!r) return;
  r.phase = 'done';
  updateControls();
  if (!r.req) return;
  const req = r.req;
  void api.finishRitual(req.id, { allow, blessed, almanacDefied: r.almanacDefied, poeDefied });
  // 讓人看一眼結果，再回到問事。
  setTimeout(() => {
    if (ritual === r) {
      ritual = null;
      updateControls();
    }
  }, 2500);
}

stage.onGrab = () => {
  $('hint').hidden = true;
  $('result').hidden = true;
};

stage.onThrow = async () => {
  if (state.closed) return null;
  if (ritual && (ritual.phase !== 'poe' || (ritual.used >= ritual.max && !ritual.revive))) return null;
  $('hint').hidden = true;
  $('result').hidden = true;
  const t = await api.throwPoe();
  if (ritual) ritual.used++;
  return t;
};

stage.onLanded = (t: PoeThrow) => {
  const ok = t.result === 'sheng';
  const r = ritual;
  if (r?.revive) {
    if (ok) {
      r.phase = 'done';
      showResult('聖筊', '神明准了，還陽中……', false);
      void api.restoreSoul(r.revive.id, false).then((res) => {
        showResult(res.ok ? '還陽' : '還陽失敗', res.message, !res.ok);
        closeRevive(r);
      });
    } else {
      showResult(POE_NAMES[t.result], `${RESULT_DESC[t.result]}。可以再擲，或強制還陽`, true);
    }
    updateControls();
    return;
  }
  if (!r) {
    showResult(POE_NAMES[t.result], RESULT_DESC[t.result], !ok);
  } else if (ok) {
    showResult('聖筊', r.req ? '神明准了，放行' : '神明准了，放行（演練）', false);
    endRitual(true, true);
    return;
  } else {
    const left = r.max - r.used;
    showResult(POE_NAMES[t.result], left > 0 ? `${RESULT_DESC[t.result]}。還能再擲 ${left} 次` : `${RESULT_DESC[t.result]}。三次用完，只能硬闖或作罷`, true);
  }
  updateControls();
};

$('btn-auto').addEventListener('click', () => {
  stage.reset();
  stage.autoThrow();
});

$('btn-drill').addEventListener('click', () => {
  if (stage.busy || ritual?.req) return;
  if (ritual) {
    ritual = null;
    $('result').hidden = true;
    $('hint').hidden = false;
    stage.reset();
    updateControls();
  } else startRitual(null);
});

$('btn-defy').addEventListener('click', async () => {
  const r = ritual;
  if (!r || r.phase === 'done' || stage.busy) return;
  if (r.revive) {
    await forceRestore(r.revive);
    return;
  }
  const d = await askConfession();
  if (!d || ritual !== r) return;
  if (r.phase === 'almanac') {
    r.almanacDefied = d;
    if (r.req && !r.req.poe) {
      showResult('硬闖', '逆天而行，放行。已記入功過簿', true);
      endRitual(true, false);
      return;
    }
    r.phase = 'poe';
    showResult('硬闖', '農民曆這關闖過了，接著擲筊', true);
    stage.reset();
    updateControls();
    return;
  }
  showResult('硬闖', r.req ? '放行。已記入功過簿' : '演練完成，這次不記功過簿', true);
  endRitual(true, false, d);
});

$('btn-giveup').addEventListener('click', () => {
  if (ritual?.revive && !stage.busy) {
    ritual = null;
    $('result').hidden = true;
    stage.reset();
    updateControls();
    return;
  }
  if (!ritual?.req || ritual.phase === 'done' || stage.busy) return;
  showResult('作罷', '從神明之意，push 取消', true);
  endRitual(false, false);
});

api.onRitualStart((req) => {
  if (ritual?.req?.id === req.id) return;
  if (dlgConfirm.open) finishConfirm(false);
  if (dlgConfess.open) finishConfess(null);
  startRitual(req);
});

api.onRitualCancel((id) => {
  if (ritual?.req?.id !== id) return;
  if (dlgConfess.open) finishConfess(null);
  ritual = null;
  $('result').hidden = true;
  stage.reset();
  updateControls();
});

// ───────── 閉廟 ─────────

$('btn-close-temple').addEventListener('click', async () => {
  render(state.closed ? await api.openTemple() : await api.closeTemple());
});

// ───────── 確認視窗（動到系統前一律先問） ─────────

const dlgConfirm = $<HTMLDialogElement>('dlg-confirm');
let confirmResolve: ((ok: boolean) => void) | null = null;

function askConfirm(title: string, body: string, okLabel: string): Promise<boolean> {
  $('confirm-title').textContent = title;
  $('confirm-body').textContent = body;
  $('confirm-ok').textContent = okLabel;
  dlgConfirm.showModal();
  return new Promise((resolve) => { confirmResolve = resolve; });
}
function finishConfirm(ok: boolean): void {
  dlgConfirm.close();
  confirmResolve?.(ok);
  confirmResolve = null;
}
$('confirm-ok').addEventListener('click', () => finishConfirm(true));
$('confirm-cancel').addEventListener('click', () => finishConfirm(false));
dlgConfirm.addEventListener('cancel', (e) => { e.preventDefault(); finishConfirm(false); });

// ───────── 擲筊 push 的安裝 ─────────

function hookMsg(text: string, ok: boolean): void {
  const m = $('hook-msg');
  m.textContent = text;
  m.className = ok ? 'ok' : 'bad';
}

async function refreshHooks(): Promise<void> {
  const h = await api.getHookStatus();
  $('hook-status').textContent = !h.gitAvailable
    ? '找不到 git，請先安裝 Git 才能使用擲筊 push。'
    : h.global
      ? '已全域安裝：這台電腦上所有 repo 的 push 都要先過主殿。'
      : h.repos.length
        ? '已安裝的 repo：'
        : '還沒有安裝到任何 repo。安裝後，git push 會先來主殿擲筊。';
  const globalBtn = $<HTMLButtonElement>('btn-hook-global');
  globalBtn.textContent = h.global ? '移除全域安裝' : '全域安裝';
  globalBtn.dataset.installed = String(h.global);
  globalBtn.disabled = !h.gitAvailable;
  $<HTMLButtonElement>('btn-hook-repo').disabled = !h.gitAvailable || h.global;
  const list = $('hook-repos');
  list.replaceChildren();
  for (const r of h.repos) {
    const li = el('li');
    const rm = el('button', '移除', 'btn small ghost');
    rm.addEventListener('click', async () => {
      if (!(await askConfirm('移除擲筊 push', `要從這個 repo 移除 pre-push hook 嗎？\n${r.path}`, '移除'))) return;
      const res = await api.uninstallRepoHook(r.path);
      hookMsg(res.message, res.ok);
      void refreshHooks();
    });
    li.append(el('code', r.path));
    if (!r.installed) li.append(el('span', 'hook 不見了', 'gone'));
    li.append(rm);
    list.append(li);
  }
}

$('btn-hook-repo').addEventListener('click', async () => {
  const dir = await api.chooseFolder();
  if (!dir) return;
  const ok = await askConfirm('安裝擲筊 push', `會在這個 repo 的 .git/hooks 裡新增一個 pre-push 檔案，之後在這個 repo 執行 git push 都要先過主殿。\n${dir}`, '安裝');
  if (!ok) return;
  const res = await api.installRepoHook(dir);
  hookMsg(res.message, res.ok);
  void refreshHooks();
});

$('btn-hook-global').addEventListener('click', async () => {
  const installed = $('btn-hook-global').dataset.installed === 'true';
  const ok = installed
    ? await askConfirm('移除全域安裝', '會把 git 的全域設定 core.hooksPath 清掉，恢復原狀。', '移除')
    : await askConfirm(
        '全域安裝擲筊 push',
        '會修改 git 的全域設定 core.hooksPath，這台電腦上所有 repo 的 push 都要先過主殿。\n\n各 repo 自己原有的 hook 會由賽博宮轉交執行，照常運作。隨時可以在這裡移除。',
        '全域安裝',
      );
  if (!ok) return;
  const res = installed ? await api.uninstallGlobalHook() : await api.installGlobalHook();
  hookMsg(res.message, res.ok);
  void refreshHooks();
});

$('protected').addEventListener('change', () => {
  void api.setProtectedBranches($<HTMLInputElement>('protected').value).then((s) => {
    $<HTMLInputElement>('protected').blur();
    render(s);
  });
});

// ───────── 陰間回收筒 ─────────

function note(id: string, text: string, ok: boolean): void {
  const m = $(id);
  m.textContent = text;
  m.className = ok ? 'ok' : 'bad';
}

function closeRevive(r: Ritual): void {
  setTimeout(() => {
    if (ritual === r) {
      ritual = null;
      updateControls();
    }
  }, 2500);
}

async function forceRestore(soul: SoulView): Promise<void> {
  const ok = await askConfirm('強制還陽', `不擲筊，直接把檔案還原到原本的位置。這會記入功過簿。\n${soul.originalPath}`, '強制還陽');
  if (!ok) return;
  const res = await api.restoreSoul(soul.id, true);
  note('uw-msg', res.message, res.ok);
  if (ritual?.revive?.id === soul.id) {
    const r = ritual;
    r.phase = 'done';
    showResult(res.ok ? '強制還陽' : '還陽失敗', res.message, true);
    updateControls();
    closeRevive(r);
  }
}

async function releaseSouls(souls: SoulView[]): Promise<void> {
  if (souls.length === 0) return;
  const names = souls.map((s) => s.name).join('、');
  const ok = await askConfirm('超渡', `要把這些檔案從陰間移到 Windows 的資源回收筒嗎？之後仍可從資源回收筒救回。\n${names}`, '超渡');
  if (!ok) return;
  const res = await api.releaseSouls(souls.map((s) => s.id));
  note('uw-msg', res.message, res.ok);
}

function renderUnderworld(s: TempleState): void {
  const on = s.features.some((f) => f.id === 'underworld' && f.enabled) && !s.closed;
  const list = $('souls');
  list.replaceChildren();
  if (s.souls.length === 0) list.append(el('li', '陰間空蕩蕩，沒有檔案。', 'muted'));
  for (const soul of s.souls) {
    const li = el('li');
    const info = el('div', '', 'info');
    info.append(el('b', soul.name), el('code', soul.originalPath));
    const revive = el('button', '請回陽間', 'btn small');
    revive.disabled = !on || !!ritual;
    revive.title = '擲到聖筊才能還原';
    revive.addEventListener('click', () => {
      if (ritual || stage.busy) return;
      ritual = { req: null, revive: soul, phase: 'poe', used: 0, max: 1 };
      $('result').hidden = true;
      $('hint').hidden = false;
      stage.reset();
      updateControls();
      $('stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const force = el('button', '強制還陽', 'btn small ghost');
    force.title = '不擲筊直接還原，會記入功過簿。隨時可用。';
    force.addEventListener('click', () => void forceRestore(soul));
    const release = el('button', '超渡', 'btn small ghost');
    release.title = '移到 Windows 的資源回收筒';
    release.addEventListener('click', () => void releaseSouls([soul]));
    li.append(info, el('span', soul.days ? `${soul.days} 天` : '今天', 'days' + (soul.overdue ? ' overdue' : '')), revive, force, release);
    list.append(li);
  }
  const overdue = s.souls.filter((x) => x.overdue);
  const btn = $<HTMLButtonElement>('btn-release-overdue');
  btn.hidden = overdue.length === 0;
  btn.textContent = `超渡滯留超過 ${s.underworldDays} 天的 ${overdue.length} 個`;
  btn.onclick = () => void releaseSouls(overdue);
  $<HTMLButtonElement>('btn-burn').disabled = !on;
  $<HTMLInputElement>('uw-menu').disabled = !s.windows;
  $<HTMLInputElement>('uw-menu').parentElement!.title = s.windows ? '' : '只有 Windows 能安裝右鍵選單';
}

// 檔案總管右鍵「燒給它」可能一次送來好幾個檔案，合成一次確認。
let burnQueue: string[] = [];
let burnPromptOpen = false;

async function promptBurn(paths: string[]): Promise<void> {
  burnQueue = [...new Set([...burnQueue, ...paths])];
  const body = () => `要把這些檔案搬到陰間嗎？之後可以在主殿請回陽間。\n${burnQueue.join('\n')}`;
  if (burnPromptOpen) {
    $('confirm-body').textContent = body();
    return;
  }
  burnPromptOpen = true;
  const ok = await askConfirm('燒給它', body(), '燒');
  burnPromptOpen = false;
  const list = burnQueue;
  burnQueue = [];
  if (!ok) {
    void api.pullBurnRequests();
    return;
  }
  const res = await api.burnFiles(list);
  note('uw-msg', res.message, res.ok);
}

$('btn-burn').addEventListener('click', async () => {
  const files = await api.chooseFiles();
  if (files.length) void promptBurn(files);
});
api.onBurnRequest((paths) => void promptBurn(paths));

async function refreshMenu(): Promise<void> {
  $<HTMLInputElement>('uw-menu').checked = await api.getContextMenu();
}
$('uw-menu').addEventListener('change', async () => {
  const box = $<HTMLInputElement>('uw-menu');
  const on = box.checked;
  const ok = await askConfirm(
    on ? '安裝右鍵選單' : '移除右鍵選單',
    on ? '會在登錄檔（只限你這個使用者）加上檔案總管右鍵選單「燒給它」。隨時可以在這裡移除。' : '會把右鍵選單的「燒給它」從登錄檔移除。',
    on ? '安裝' : '移除',
  );
  if (ok) {
    const res = await api.setContextMenu(on);
    note('uw-msg', res.message, res.ok);
  }
  void refreshMenu();
});

// ───────── 收驚 ─────────

const dlgSj = $<HTMLDialogElement>('dlg-shoujing');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function renderShoujing(s: TempleState): void {
  const list = $('scared');
  list.replaceChildren();
  const on = s.features.some((f) => f.id === 'shoujing' && f.enabled) && !s.closed;
  if (s.scared.length === 0) {
    list.append(el('li', !s.windows ? '收驚要讀 Windows 的當機紀錄，只在 Windows 上運作。' : on ? '目前沒有程式被嚇到。' : '收驚暫停中。', 'muted'));
  }
  for (const sc of s.scared) {
    const li = el('li');
    const info = el('div', '', 'info');
    info.append(el('b', `${sc.name} 被嚇到了`), el('code', `一小時內當掉 ${sc.count} 次　出事的模組：${sc.module || '不明'}`));
    const go = el('button', '收驚', 'btn small');
    go.addEventListener('click', () => void runShoujing(sc));
    li.append(info, go);
    list.append(li);
  }
  $<HTMLButtonElement>('btn-crash-check').disabled = !on;
}

async function runShoujing(sc: Scared): Promise<void> {
  const cloth = $('sj-cloth');
  cloth.replaceChildren(el('b', sc.name), `一小時內當掉 ${sc.count} 次`, el('br'), `最後一次 ${fmtTime(sc.lastTime)}`, el('br'), `模組 ${sc.module || '不明'}　代碼 ${sc.code || '不明'}`);
  const text = $('sj-text');
  text.replaceChildren();
  for (const id of ['sj-ask', 'sj-yes', 'sj-no']) $(id).hidden = true;
  const orbit = dlgSj.querySelector('.orbit')!;
  orbit.classList.remove('go');
  dlgSj.showModal();
  void (orbit as HTMLElement).offsetWidth;
  orbit.classList.add('go'); // 衣服在香爐上繞三圈
  const lines = shoujingText(sc.name);
  for (let i = 0; i < lines.length; i += 2) {
    text.replaceChildren(el('span', lines[i] + (lines[i + 1] ?? '')));
    await sleep(1560);
    if (!dlgSj.open) return;
  }
  orbit.classList.remove('go');
  text.replaceChildren(el('span', '收驚完畢。'));
  await api.finishShoujing(sc.key).then(render);
  const ask = $('sj-ask');
  ask.hidden = false;
  const yes = $<HTMLButtonElement>('sj-yes');
  const no = $<HTMLButtonElement>('sj-no');
  no.hidden = false;
  if (sc.path) {
    ask.textContent = `要不要重新啟動 ${sc.name}？\n${sc.path}`;
    yes.hidden = false;
    no.textContent = '不用';
  } else {
    ask.textContent = `查不到 ${sc.name} 的位置，要用的話請自己重新開啟。`;
    no.textContent = '知道了';
  }
  yes.onclick = async () => {
    const res = await api.restartProgram(sc.path);
    note('sj-msg', res.message, res.ok);
    dlgSj.close();
  };
  no.onclick = () => dlgSj.close();
}

$('btn-crash-check').addEventListener('click', async () => {
  note('sj-msg', '檢查中……', true);
  render(await api.checkCrashes());
  note('sj-msg', '', true);
});

// ───────── 中元普渡 ─────────

const dlgPudu = $<HTMLDialogElement>('dlg-pudu');
let puduGhosts: Ghost[] = [];

function renderPudu(s: TempleState): void {
  const on = s.features.some((f) => f.id === 'pudu' && f.enabled) && !s.closed;
  $<HTMLButtonElement>('btn-pudu').disabled = !on;
  $('btn-pudu').textContent = s.almanac.ghostMonth ? '辦普渡' : '辦小普渡';
  const white = $<HTMLInputElement>('pudu-white');
  if (document.activeElement !== white) white.value = s.puduWhitelist.join(', ');
  const remind = $('pudu-remind');
  remind.hidden = s.puduReminder === 'none';
  if (s.puduReminder !== 'none') {
    const go = el('button', '辦普渡', 'btn small');
    go.addEventListener('click', () => {
      void api.dismissPuduReminder().then(render);
      void runPudu();
    });
    const later = el('button', s.puduReminder === 'zhongyuan' ? '今天不辦' : '今年先不用', 'btn small ghost');
    later.addEventListener('click', () => void api.dismissPuduReminder().then(render));
    remind.replaceChildren(s.puduReminder === 'zhongyuan' ? '今日農曆七月十五，中元正日。要不要辦一場普渡？' : '農曆七月到了。要不要辦一場普渡，超渡沒有回應的程式？', el('span', '', 'spacer'), go, later);
  }
}

async function runPudu(): Promise<void> {
  $('pudu-anim').hidden = false;
  $('pudu-list').hidden = true;
  $('pudu-close').hidden = true;
  $('pudu-result').textContent = '';
  dlgPudu.showModal();
  // 儀式進行的同時去清點名單。
  const [ghosts] = await Promise.all([api.findGhosts(), sleep(3600)]);
  if (!dlgPudu.open) return;
  puduGhosts = ghosts;
  $('pudu-anim').hidden = true;
  $('pudu-list').hidden = false;
  const hung = ghosts.filter((g) => g.kind === 'hung').length;
  $('pudu-summary').textContent = ghosts.length
    ? `找到 ${ghosts.length} 個可以超渡的程式：沒有回應的 ${hung} 個（已勾選），殘留在背景的 ${ghosts.length - hung} 個（預設不勾）。\n系統程式、系統服務、防毒軟體和賽博宮自己不在名單上。`
    : state.windows ? '四方平靜，沒有需要超渡的程式。' : '普渡要清點 Windows 的執行中程式，只在 Windows 上運作。';
  const body = $('pudu-body');
  body.replaceChildren();
  for (const g of ghosts) {
    const tr = el('tr');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = g.kind === 'hung';
    box.dataset.pid = String(g.pid);
    box.setAttribute('aria-label', g.name);
    box.addEventListener('change', updatePuduButton);
    const td = el('td');
    td.append(box);
    tr.append(td, el('td', `${g.name}${g.title ? `（${g.title}）` : ''}`), el('td', g.kind === 'hung' ? '沒有回應' : '殘留在背景，幾乎沒在動'), el('td', `${g.hours} 小時`), el('td', g.path));
    body.append(tr);
  }
  body.closest('.tablewrap')!.toggleAttribute('hidden', ghosts.length === 0);
  $('pudu-go').hidden = ghosts.length === 0;
  $('pudu-cancel').textContent = ghosts.length ? '不超渡' : '收壇';
  updatePuduButton();
}

function checkedPids(): number[] {
  return [...$('pudu-body').querySelectorAll<HTMLInputElement>('input:checked')].map((b) => Number(b.dataset.pid));
}
function updatePuduButton(): void {
  const n = checkedPids().length;
  const go = $<HTMLButtonElement>('pudu-go');
  go.disabled = n === 0;
  go.textContent = `超渡勾選的 ${n} 個`;
}

$('btn-pudu').addEventListener('click', () => void runPudu());
$('pudu-cancel').addEventListener('click', () => dlgPudu.close());
$('pudu-close').addEventListener('click', () => dlgPudu.close());
$('pudu-go').addEventListener('click', async () => {
  const pids = checkedPids();
  const names = puduGhosts.filter((g) => pids.includes(g.pid)).map((g) => g.name).join('、');
  const ok = await askConfirm('超渡', `要結束這 ${pids.length} 個程式嗎？它們還沒儲存的資料會遺失。\n${names}`, '超渡');
  if (!ok) return;
  const res = await api.releaseGhosts(pids);
  $('pudu-result').textContent = [res.released.length ? `已超渡：${res.released.join('、')}` : '', res.skipped.length ? `沒有超渡：${res.skipped.join('、')}` : ''].filter(Boolean).join('\n');
  for (const b of $('pudu-body').querySelectorAll<HTMLInputElement>('input')) b.disabled = true;
  $('pudu-go').hidden = true;
  $('pudu-cancel').textContent = '收壇';
  note('pudu-msg', `普渡圓滿，超渡了 ${res.released.length} 個程式。`, true);
});
$('pudu-white').addEventListener('change', () => {
  void api.setPuduWhitelist($<HTMLInputElement>('pudu-white').value).then((s) => {
    $<HTMLInputElement>('pudu-white').blur();
    render(s);
  });
});

// ───────── 籤詩 code review ─────────

const dlgFortune = $<HTMLDialogElement>('dlg-fortune');
let lastFortune: FortuneReport | null = null;

function fortuneSummary(r: FortuneReport): string {
  return r.poem ? `${r.poemTitle.replace('　', ' ')}，${r.issues.length} 個問題` : '抽不出籤';
}

function setLastFortune(r: FortuneReport | null): void {
  lastFortune = r;
  const p = $('fortune-last');
  p.replaceChildren();
  if (!r) return;
  const b = el('button', '看籤', 'link');
  b.addEventListener('click', () => showFortune(r));
  p.append(`最近一支：${r.repo}　${fortuneSummary(r)}　`, b);
  updateControls();
}

function showFortune(r: FortuneReport): void {
  $('f-title').textContent = r.poem ? r.poemTitle : '抽不出籤';
  $('f-sub').textContent = `${r.repo}｜比較基準：${r.base}｜${r.changedFiles} 個檔案、${r.changedLines} 行程式碼${r.poem ? `｜業障 ${r.score}` : ''}`;
  const poem = $('f-poem');
  poem.hidden = !r.poem;
  // 直書：每句一行、由右到左，每個字各佔一格（不依賴字型的直排支援）。
  poem.replaceChildren(
    ...(r.poem?.lines ?? []).map((l) => {
      const col = el('span');
      col.setAttribute('aria-label', l);
      col.append(...[...l].map((ch) => el('i', ch)));
      return col;
    }),
  );
  $('f-nodraw').hidden = !r.noDraw;
  $('f-nodraw').textContent = r.noDraw ?? '';

  $('f-jie-sec').hidden = r.jie.length === 0;
  $('f-jie').replaceChildren(...r.jie.map((j) => el('li', j)));

  $('f-issues-sec').hidden = !r.poem;
  $('f-count').textContent = r.issues.length ? `共 ${r.issues.length} 個問題` : '這次改動沒有查到問題';
  const body = $('f-issues');
  body.replaceChildren();
  for (const i of r.issues) {
    const tr = el('tr');
    tr.append(el('td', `${i.file}:${i.line}`), el('td', SEVERITY_NAMES[i.severity], `sev ${i.severity}`), el('td', `${i.tool} ${i.id}`), el('td', i.message));
    body.append(tr);
  }
  body.closest('.tablewrap')!.toggleAttribute('hidden', r.issues.length === 0);

  $('f-names-sec').hidden = r.badNames.length === 0 && r.nameSkipped.length === 0;
  const names = $('f-names');
  names.replaceChildren();
  for (const n of r.badNames) {
    const li = el('li');
    li.append(el('b', n.name), `　${n.strokes} 畫${n.number !== n.strokes ? `（化為 ${n.number}）` : ''}，凶：${n.label}`);
    names.append(li);
  }
  $('f-names-note').textContent =
    (r.names.length ? `這次新增 ${r.names.length} 個名字，${r.badNames.length} 個屬凶。只是建議，不擋。` : '') +
    (r.nameSkipped.length ? `　查不到筆畫、未列入：${r.nameSkipped.join('、')}` : '');

  const tools = $('f-tools');
  tools.replaceChildren();
  if (r.tools.length === 0) tools.append(el('li', '沒有可檢查的程式碼檔案。', 'muted'));
  for (const t of r.tools) {
    tools.append(el('li', `${t.langName}（${t.files} 個檔案）：${t.status === 'ok' ? `已用 ${t.tool} 檢查${t.detail ? `。${t.detail}` : ''}` : `略過。${t.detail}`}`, t.status));
  }
  if (!dlgFortune.open) dlgFortune.showModal();
}

dlgFortune.querySelector('[data-close]')!.addEventListener('click', () => dlgFortune.close());

$('btn-fortune').addEventListener('click', async () => {
  const msg = $('fortune-msg');
  const btn = $<HTMLButtonElement>('btn-fortune');
  const dir = $<HTMLSelectElement>('fortune-repo').value || (await api.chooseFolder());
  if (!dir) return;
  msg.className = 'muted';
  msg.textContent = '搖籤筒中……';
  btn.disabled = true;
  const r = await api.drawFortune(dir);
  btn.disabled = false;
  if (!r.ok) {
    msg.className = 'bad';
    msg.textContent = r.message;
    return;
  }
  msg.textContent = '';
  setLastFortune(r.report);
  showFortune(r.report);
  $<HTMLSelectElement>('fortune-repo').value = r.report.repoPath;
});

$('auto-fortune').addEventListener('change', () => {
  void api.setAutoFortune($<HTMLInputElement>('auto-fortune').checked).then(render);
});

api.onFortune((r) => setLastFortune(r));

// ───────── 功過簿 ─────────

const dlgLedger = $<HTMLDialogElement>('dlg-ledger');
let ledgerEntries: LedgerEntry[] = [];
let ledgerBrokenAt: number | undefined;

function renderLedger(): void {
  const q = $<HTMLInputElement>('ledger-search').value.trim().toLowerCase();
  const body = $('ledger-body');
  body.replaceChildren();
  const rows = ledgerEntries
    .filter((e) => !q || [e.feature, e.action, e.target, e.confession, fmtTime(e.time)].some((v) => v.toLowerCase().includes(q)))
    .slice()
    .reverse();
  for (const e of rows) {
    const tr = el('tr', '', ledgerBrokenAt !== undefined && e.seq >= ledgerBrokenAt ? 'broken' : '');
    for (const v of [String(e.seq), fmtTime(e.time), e.feature, e.action, e.target, e.confession || '—']) tr.append(el('td', v));
    body.append(tr);
  }
  const empty = $('ledger-empty');
  empty.hidden = rows.length > 0;
  empty.textContent = ledgerEntries.length ? '沒有符合的紀錄。' : '功過簿上還是一片空白。';
}

async function openLedger(): Promise<void> {
  const v = await api.getLedger();
  ledgerEntries = v.entries;
  ledgerBrokenAt = v.ok ? undefined : v.brokenAt;
  const warn = $('ledger-warn');
  warn.hidden = v.ok;
  warn.textContent = v.ok ? '' : `功過簿遭竄改：${v.reason ?? '內容對不上'}。標紅的紀錄已不可信。`;
  $('data-dir').textContent = state.dataDir;
  $<HTMLInputElement>('ledger-search').value = '';
  renderLedger();
  dlgLedger.showModal();
}

$('btn-ledger').addEventListener('click', () => void openLedger());
$('btn-tamper-open').addEventListener('click', () => void openLedger());
$('ledger-search').addEventListener('input', renderLedger);
dlgLedger.querySelector('[data-close]')!.addEventListener('click', () => dlgLedger.close());

// ───────── 懺悔文 ─────────

const dlgConfess = $<HTMLDialogElement>('dlg-confess');
const confessInput = $<HTMLTextAreaElement>('confess-input');
let confessPrompt: ConfessionPrompt | null = null;
let confessResolve: ((d: Defiance | null) => void) | null = null;

function renderConfess(): void {
  if (!confessPrompt) return;
  const text = confessPrompt.text;
  const typed = normalizeTyped(confessInput.value);
  const good = correctPrefixLength(text, confessInput.value);
  const wrong = typed.length > good;
  const box = $('confess-text');
  box.replaceChildren();
  if (good) box.append(el('span', text.slice(0, good), 'done'));
  if (wrong && good < text.length) box.append(el('span', text[good], 'wrong'));
  const rest = text.slice(good + (wrong && good < text.length ? 1 : 0));
  if (rest) box.append(el('span', rest, 'todo'));
  const msg = $('confess-msg');
  const complete = typed === text;
  msg.className = complete ? 'ok' : wrong ? 'bad' : 'muted';
  msg.textContent = complete ? '' : wrong ? `第 ${good + 1} 個字打錯了` : `${good} / ${text.length}`;
  $<HTMLButtonElement>('confess-ok').disabled = !complete;
}

function blockPaste(e: Event): void {
  e.preventDefault();
  const msg = $('confess-msg');
  msg.className = 'bad';
  msg.textContent = '不能貼上';
}

confessInput.addEventListener('paste', blockPaste);
confessInput.addEventListener('drop', blockPaste);
confessInput.addEventListener('beforeinput', (e) => {
  if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop' || e.inputType === 'insertFromYank') blockPaste(e);
});
confessInput.addEventListener('input', renderConfess);

function finishConfess(d: Defiance | null): void {
  dlgConfess.close();
  confessResolve?.(d);
  confessResolve = null;
  // 第一次打完之後提示一次：長度可以調。
  if (d !== null && !state.confessionHintShown) {
    $('toast').hidden = false;
    void api.markConfessionHintShown().then(render);
  }
}

$('toast-close').addEventListener('click', () => { $('toast').hidden = true; });
$('confess-ok').addEventListener('click', () => {
  if (confessPrompt && normalizeTyped(confessInput.value) === confessPrompt.text) {
    finishConfess({ confessionId: confessPrompt.id, typed: confessPrompt.text });
  }
});
$('confess-cancel').addEventListener('click', () => finishConfess(null));
dlgConfess.addEventListener('cancel', (e) => {
  e.preventDefault();
  finishConfess(null);
});

/** 跳出懺悔文，打完回傳打了哪一版，作罷回傳 null。 */
async function askConfession(): Promise<Defiance | null> {
  confessPrompt = await api.pickConfession();
  confessInput.value = '';
  renderConfess();
  dlgConfess.showModal();
  confessInput.focus();
  return new Promise((resolve) => { confessResolve = resolve; });
}

// ───────── 啟動 ─────────

api.onStateChanged(render);
void api.getState().then(async (s) => {
  render(s);
  void refreshHooks();
  setLastFortune(await api.getLastFortune());
  void refreshMenu();
  const burning = await api.pullBurnRequests();
  if (burning.length) void promptBurn(burning);
  // 主殿是被 git push 叫起來的話，一開門就有儀式在等。
  const pending = await api.pullRitual();
  if (pending) startRitual(pending);
});
