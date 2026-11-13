import { PoeStage } from './poe-stage.ts';
import { createMock } from './mock.ts';
import { POE_NAMES, type PoeResult, type PoeThrow } from '../core/poe.ts';
import { correctPrefixLength, normalizeTyped } from '../core/confession.ts';
import type { ConfessionPrompt, TempleApi, TempleState } from '../shared/api.ts';
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
  stage.enabled = !s.closed;
  $<HTMLButtonElement>('btn-auto').disabled = s.closed;
  $<HTMLButtonElement>('btn-drill').disabled = s.closed;
  if (s.closed) { $('hint').hidden = true; $('result').hidden = true; }

  $('today').textContent = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  const stats = $('stats');
  stats.replaceChildren();
  for (const [label, n] of [['共擲', s.stats.throws], ['聖筊', s.stats.sheng], ['笑筊', s.stats.xiao], ['陰筊', s.stats.yin]] as const) {
    const d = el('div');
    d.append(el('b', String(n)), el('span', label));
    stats.append(d);
  }

  const recent = $('recent');
  recent.replaceChildren();
  if (s.recentLedger.length === 0) recent.append(el('li', '功過簿上還是一片空白。', 'muted'));
  for (const e of s.recentLedger) {
    const li = el('li');
    li.append(el('time', fmtTime(e.time)), document.createTextNode(`${e.feature}・${e.action}：${e.target}`));
    recent.append(li);
  }

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
    const spacer = el('span', '', 'spacer');
    li.append(box, txt, spacer, el('span', f.available ? f.stage : `${f.stage} 開光`, 'tag'));
    feats.append(li);
  }
}

// ───────── 擲筊 ─────────

const stage = new PoeStage($<HTMLCanvasElement>('poe'));
const MAX_DRILL_THROWS = 3;
let drill: { used: number; done: boolean } | null = null;

function showResult(name: string, desc: string, bad: boolean): void {
  $('result-name').textContent = name;
  $('result-desc').textContent = desc;
  $('result').classList.toggle('no', bad);
  $('result').hidden = false;
}

function updateMode(): void {
  const label = $('mode-label');
  const auto = $<HTMLButtonElement>('btn-auto');
  const defy = $('btn-defy');
  const drillBtn = $('btn-drill');
  if (!drill) {
    label.textContent = '問事（不限次數）';
    auto.hidden = false;
    auto.textContent = '代為擲筊';
    defy.hidden = true;
    drillBtn.textContent = '演練 push 儀式';
    return;
  }
  drillBtn.textContent = '結束演練';
  const left = MAX_DRILL_THROWS - drill.used;
  label.textContent = drill.done ? '演練結束' : `演練 push：第 ${Math.min(drill.used + 1, MAX_DRILL_THROWS)} / ${MAX_DRILL_THROWS} 擲`;
  auto.hidden = drill.done || left === 0;
  auto.textContent = drill.used === 0 ? '代為擲筊' : '再擲一次';
  defy.hidden = drill.done || drill.used === 0;
  if (!drill.done && left === 0) label.textContent = '演練 push：三次用完，神明不准';
}

stage.onGrab = () => {
  $('hint').hidden = true;
  $('result').hidden = true;
};

stage.onThrow = async () => {
  if (state.closed) return null;
  if (drill && (drill.done || drill.used >= MAX_DRILL_THROWS)) return null;
  $('hint').hidden = true;
  $('result').hidden = true;
  const t = await api.throwPoe();
  if (drill) drill.used++;
  return t;
};

stage.onLanded = (t: PoeThrow) => {
  const ok = t.result === 'sheng';
  if (!drill) {
    showResult(POE_NAMES[t.result], RESULT_DESC[t.result], !ok);
  } else if (ok) {
    drill.done = true;
    showResult('聖筊', '神明准了，放行（演練）', false);
  } else {
    const left = MAX_DRILL_THROWS - drill.used;
    showResult(POE_NAMES[t.result], left > 0 ? `${RESULT_DESC[t.result]}。還能再擲 ${left} 次，或硬闖` : `${RESULT_DESC[t.result]}。三次用完，只能硬闖或作罷`, true);
  }
  updateMode();
};

$('btn-auto').addEventListener('click', () => {
  stage.reset();
  stage.autoThrow();
});

$('btn-drill').addEventListener('click', () => {
  if (stage.busy) return;
  drill = drill ? null : { used: 0, done: false };
  $('result').hidden = true;
  $('hint').hidden = false;
  stage.reset();
  updateMode();
});

$('btn-defy').addEventListener('click', async () => {
  if (!drill || stage.busy) return;
  const done = await askConfession();
  if (!done) return;
  drill.done = true;
  showResult('硬闖', '演練完成，這次不記功過簿', true);
  updateMode();
});

// ───────── 閉廟 ─────────

$('btn-close-temple').addEventListener('click', async () => {
  render(state.closed ? await api.openTemple() : await api.closeTemple());
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
let confessResolve: ((typed: string | null) => void) | null = null;

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
  msg.textContent = complete ? '一字不差。' : wrong ? `第 ${good + 1} 個字打錯了，請改正。` : `${good} / ${text.length} 字`;
  $<HTMLButtonElement>('confess-ok').disabled = !complete;
}

function blockPaste(e: Event): void {
  e.preventDefault();
  const msg = $('confess-msg');
  msg.className = 'bad';
  msg.textContent = '懺悔要親手打，不能貼上。';
}

confessInput.addEventListener('paste', blockPaste);
confessInput.addEventListener('drop', blockPaste);
confessInput.addEventListener('beforeinput', (e) => {
  if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop' || e.inputType === 'insertFromYank') blockPaste(e);
});
confessInput.addEventListener('input', renderConfess);

function finishConfess(typed: string | null): void {
  dlgConfess.close();
  confessResolve?.(typed);
  confessResolve = null;
}
$('confess-ok').addEventListener('click', () => {
  if (confessPrompt && normalizeTyped(confessInput.value) === confessPrompt.text) finishConfess(confessPrompt.text);
});
$('confess-cancel').addEventListener('click', () => finishConfess(null));
dlgConfess.addEventListener('cancel', (e) => {
  e.preventDefault();
  finishConfess(null);
});

/** 跳出懺悔文，打完回傳全文，作罷回傳 null。 */
async function askConfession(): Promise<string | null> {
  confessPrompt = await api.pickConfession();
  $('confess-title').textContent = confessPrompt.title;
  confessInput.value = '';
  renderConfess();
  dlgConfess.showModal();
  confessInput.focus();
  return new Promise((resolve) => { confessResolve = resolve; });
}

// ───────── 啟動 ─────────

api.onStateChanged(render);
void api.getState().then((s) => {
  render(s);
  updateMode();
});
