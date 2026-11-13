import { PoeStage } from './poe-stage.ts';
import { createMock } from './mock.ts';
import { POE_NAMES, type PoeResult, type PoeThrow } from '../core/poe.ts';
import { CONFESSION_LENGTHS, correctPrefixLength, normalizeTyped } from '../core/confession.ts';
import type { ConfessionPrompt, Defiance, RitualRequest, TempleApi, TempleState } from '../shared/api.ts';
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
  $('kaishi').hidden = !s.almanac.jiKaishi;
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

  banner.hidden = !r?.req;
  if (r?.req) {
    banner.replaceChildren('git push 求神明准許：', el('b', `${r.req.repo} → ${r.req.refs}`));
  }

  stage.enabled = !closed && (!r || (r.phase === 'poe' && left > 0));
  auto.disabled = closed;
  drillBtn.disabled = closed;
  drillBtn.hidden = !!r?.req;
  drillBtn.textContent = r ? '結束演練' : '演練 push 儀式';

  if (!r) {
    label.textContent = '問事（不限次數）';
    auto.hidden = false;
    auto.textContent = '代為擲筊';
    defy.hidden = true;
    giveup.hidden = true;
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
    defy.hidden = r.used === 0;
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
  if (ritual && (ritual.phase !== 'poe' || ritual.used >= ritual.max)) return null;
  $('hint').hidden = true;
  $('result').hidden = true;
  const t = await api.throwPoe();
  if (ritual) ritual.used++;
  return t;
};

stage.onLanded = (t: PoeThrow) => {
  const ok = t.result === 'sheng';
  const r = ritual;
  if (!r) {
    showResult(POE_NAMES[t.result], RESULT_DESC[t.result], !ok);
  } else if (ok) {
    showResult('聖筊', r.req ? '神明准了，放行' : '神明准了，放行（演練）', false);
    endRitual(true, true);
    return;
  } else {
    const left = r.max - r.used;
    showResult(POE_NAMES[t.result], left > 0 ? `${RESULT_DESC[t.result]}。還能再擲 ${left} 次，或硬闖` : `${RESULT_DESC[t.result]}。三次用完，只能硬闖或作罷`, true);
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
  if (!ritual?.req || ritual.phase === 'done' || stage.busy) return;
  showResult('作罷', '從神明之意，push 取消', true);
  endRitual(false, false);
});

api.onRitualStart((req) => {
  if (ritual?.req?.id === req.id) return;
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
$('toast-go').addEventListener('click', () => {
  $('toast').hidden = true;
  const card = $('card-confess');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.remove('flash');
  void card.offsetWidth;
  card.classList.add('flash');
  card.querySelector<HTMLButtonElement>('button[aria-checked=true]')?.focus();
});
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
  // 主殿是被 git push 叫起來的話，一開門就有儀式在等。
  const pending = await api.pullRitual();
  if (pending) startRitual(pending);
});
