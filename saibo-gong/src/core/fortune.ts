// 籤詩 code review：把靜態檢查的結果算成分數、對應籤等、抽一支籤，
// 並把真實的問題翻成民俗說法（解曰），同時保留準確的白話清單。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectChanges, type ChangeSet } from './diff.ts';
import { lintFiles, langOf, type Issue, type Lang, type Severity, type ToolRun } from './linters.ts';
import { GRADE_NAMES, GRADE_ORDER, chineseNumber, drawPoem, type Grade, type Poem } from './fortune-poems.ts';
import { LUCK_NAMES, declaredNames, readName, type NameReading, type StrokeTable } from './nameology.ts';

// ───── 評分規則（集中在這裡，方便調整） ─────

export const SEVERITY_WEIGHT: Record<Severity, number> = { error: 10, warning: 5, performance: 3, portability: 3, style: 1, information: 0 };
export { SEVERITY_NAMES } from './fortune-names.ts';

/** 分數 = 加權問題數 ÷ 改動行數 × 100（每一百行改動背了多少「業障」）。分數低於門檻就是該籤等。 */
export const GRADE_LIMITS: [Grade, number][] = [
  ['shangshang', 0],
  ['shangji', 2],
  ['zhongji', 6],
  ['zhongping', 15],
];

export function gradeOf(issues: Pick<Issue, 'severity'>[], changedLines: number): { score: number; grade: Grade } {
  const weight = issues.reduce((n, i) => n + SEVERITY_WEIGHT[i.severity], 0);
  const score = Math.round((weight / Math.max(changedLines, 1)) * 1000) / 10;
  let grade: Grade = 'xiaxia';
  for (const [g, limit] of GRADE_LIMITS) {
    if (score <= limit) { grade = g; break; }
  }
  // 再乾淨的改動，只要有「錯誤」等級的問題就不會好過中平；三個以上直接下下。
  const errors = issues.filter((i) => i.severity === 'error').length;
  const worst = (a: Grade, b: Grade) => (GRADE_ORDER.indexOf(a) > GRADE_ORDER.indexOf(b) ? a : b);
  if (errors >= 3) grade = 'xiaxia';
  else if (errors >= 1) grade = worst(grade, 'zhongping');
  return { score, grade };
}

// ───── 解曰：不同類型的問題各有說法 ─────

const JIE_RULES: [RegExp, string[]][] = [
  [/memleak|resourceLeak|leak/i, ['有借無還，記憶體恐成孤魂野鬼，宜速超渡', '門戶未關，財氣外洩，日久必虛']],
  [/deallocuse|useAfterFree|doubleFree|deallocret|danglingLifetime|invalidLifetime|returnDanglingLifetime/i, ['已入土者不可再擾，強行驚動恐有血光之災', '陰陽不分，往生之物豈可再碰']],
  [/nullPointer|ctunullpointer|nullPointerRedundantCheck/i, ['所指之處空無一物，如問路於無人之境，恐有血光之災']],
  [/uninit/i, ['未開光即上供，所得何物全憑天意']],
  [/arrayIndex|bufferAccess|outOfBounds|containerOutOfBounds|negativeIndex/i, ['越界踏入鄰家宅院，壞人風水，恐遭報應']],
  [/syntax|parse|^E9|invalid-syntax/i, ['符咒畫錯一筆，全壇失靈，須重畫方可']],
  [/F821|F822|no-undef|undefined/i, ['所請之神查無此尊，名字喊錯，無人應答']],
  [/unused|unread|F401|F841|F811|no-unused/i, ['供品擺了無人享用，徒佔神桌，宜撤', '有名無實，掛著虛銜，不如歸去']],
  [/duplicate|knownCondition|selfAssign|identical|redundant|no-constant|no-dupe|no-self|oppositeInner|F632|B0/i, ['左右互搏，自相矛盾，恐鬼打牆繞不出去']],
  [/^S\d|no-eval|no-implied-eval|security/i, ['門戶洞開，恐引外鬼入宅']],
  [/shadow|redefin/i, ['同名相沖，一山不容二虎，必有一傷']],
  [/divide|zerodiv/i, ['以零為除，如叩無底之淵，必墜']],
  [/missingReturn|consistent-return/i, ['有去無回，問卜不得回音']],
];
const JIE_BY_SEVERITY: Record<Severity, string[]> = {
  error: ['犯了大忌，恐有血光之災，不改不可行'],
  warning: ['氣場不順，隱隱有煞，宜早化解'],
  performance: ['繞路而行，香火錢白白多花'],
  portability: ['此法只在本廟靈驗，換了地方恐不通'],
  style: ['儀容不整，雖不犯戒，有礙觀瞻'],
  information: ['無傷大雅，知之即可'],
};

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function jieFor(issue: Issue): string {
  const key = `${issue.id} ${issue.message}`;
  const pool = JIE_RULES.find(([re]) => re.test(issue.id) || re.test(key))?.[1] ?? JIE_BY_SEVERITY[issue.severity];
  const where = `${issue.file} 第 ${issue.line} 行`;
  return `${where}：${pool[hash(where + issue.id) % pool.length]}。`;
}

const JIE_OPENING: Record<Grade, string> = {
  shangshang: '此籤大吉。所問之碼氣脈通暢，神明無可挑剔，放心去吧。',
  shangji: '此籤為吉。大體平順，惟有幾處微塵，掃淨更佳。',
  zhongji: '此籤中吉。有好有壞，尚可前行，然隱患不可不除。',
  zhongping: '此籤中平。煞氣已現，勉強上路恐生事端，宜先化解。',
  xiaxia: '此籤大凶。業障深重，此時上線，神明也保不住。',
};

// ───── 報告 ─────

export interface FortuneReport {
  time: string;
  repo: string;
  repoPath: string;
  base: string;
  changedFiles: number;
  changedLines: number;
  tools: Omit<ToolRun, 'issues'>[];
  /** 抽不出籤的原因（沒有改動、沒有可檢查的檔案、工具都沒裝）；有籤時是 null。 */
  noDraw: string | null;
  grade: Grade | null;
  gradeName: string;
  score: number;
  poem: Poem | null;
  poemTitle: string;
  jie: string[]; // 解曰
  issues: Issue[]; // 白話：只含這次改動的行
  names: NameReading[]; // 這次新增的識別字
  badNames: NameReading[]; // 宜改名
  nameSkipped: string[]; // 查不到筆畫的名字
}

const SEV_RANK: Severity[] = ['error', 'warning', 'performance', 'portability', 'style', 'information'];

export function loadStrokeTable(dataDir: string, bundled: string): StrokeTable {
  // 對照表放在資料夾裡讓使用者能改；第一次用時從 App 內建的複製一份。
  const file = join(dataDir, 'letter-strokes.json');
  try {
    if (!existsSync(file)) {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(file, readFileSync(bundled, 'utf8'), 'utf8');
    }
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const table: StrokeTable = {};
    for (const [k, v] of Object.entries(raw)) if (k.length === 1 && typeof v === 'number') table[k.toUpperCase()] = v;
    if (Object.keys(table).length) return table;
  } catch {
    /* 檔案壞了就用內建的 */
  }
  const raw = JSON.parse(readFileSync(bundled, 'utf8')) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => k.length === 1 && typeof v === 'number')) as StrokeTable;
}

export function namesFromChanges(changes: ChangeSet, table: StrokeTable): { names: NameReading[]; skipped: string[] } {
  const seen = new Set<string>();
  const names: NameReading[] = [];
  const skipped: string[] = [];
  for (const f of changes.files) {
    const lang = langOf(f.file);
    if (!lang) continue;
    for (const name of declaredNames(lang, f.added)) {
      // 改動前就在這個檔案裡出現過的名字，不算新增或改名。
      if (seen.has(name) || new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(f.oldText)) continue;
      seen.add(name);
      const r = readName(name, table);
      if (r) names.push(r);
      else skipped.push(name);
    }
  }
  return { names, skipped };
}

export interface FortuneOptions {
  repoPath: string;
  repoName: string;
  preferredBase?: string;
  nameology: boolean;
  strokeTable: StrokeTable;
  random?: () => number;
}

export async function drawFortune(opt: FortuneOptions): Promise<FortuneReport> {
  const changes = await collectChanges(opt.repoPath, opt.preferredBase);
  const lintable = changes.files.filter((f) => langOf(f.file));
  const runs = await lintFiles(opt.repoPath, lintable.map((f) => f.file));
  const changedLines = lintable.reduce((n, f) => n + f.lines.size, 0);

  // 只看這次改動到的行。
  const lineSets = new Map(lintable.map((f) => [f.file, f.lines]));
  const issues = runs
    .flatMap((r) => r.issues)
    .filter((i) => lineSets.get(i.file)?.has(i.line))
    .sort((a, b) => SEV_RANK.indexOf(a.severity) - SEV_RANK.indexOf(b.severity) || a.file.localeCompare(b.file) || a.line - b.line);

  const okLangs = new Set<Lang>(runs.filter((r) => r.status === 'ok').map((r) => r.lang));
  let noDraw: string | null = null;
  if (changes.files.length === 0) noDraw = '和上次 push 相比沒有任何改動，無事可問。';
  else if (lintable.length === 0) noDraw = '這次改動裡沒有 C/C++、Python、JavaScript/TypeScript 的程式碼，神明無從審視。';
  else if (okLangs.size === 0) noDraw = '需要的檢查工具都沒有裝好，神明無從審視。';

  const { names, skipped } = opt.nameology ? namesFromChanges(changes, opt.strokeTable) : { names: [], skipped: [] };
  const badNames = names.filter((n) => n.luck === 'xiong');

  const base: FortuneReport = {
    time: new Date().toISOString(),
    repo: opt.repoName,
    repoPath: opt.repoPath,
    base: changes.base,
    changedFiles: changes.files.length,
    changedLines,
    tools: runs.map(({ issues: _i, ...r }) => r),
    noDraw,
    grade: null,
    gradeName: '',
    score: 0,
    poem: null,
    poemTitle: '',
    jie: [],
    issues,
    names,
    badNames,
    nameSkipped: skipped,
  };
  if (noDraw) return base;

  const { score, grade } = gradeOf(issues, changedLines);
  const poem = drawPoem(grade, opt.random);
  const jie = [JIE_OPENING[grade]];
  const top = issues.slice(0, 5);
  for (const i of top) jie.push(jieFor(i));
  if (issues.length > top.length) jie.push(`另有 ${issues.length - top.length} 處小煞，詳見白話。`);
  const skippedLangs = runs.filter((r) => r.status !== 'ok');
  if (skippedLangs.length) jie.push(`${skippedLangs.map((r) => r.langName).join('、')} 的部分神明未能過目，此籤只論其餘。`);
  if (badNames.length) {
    const shown = badNames.slice(0, 3).map((n) => `「${n.name}」${n.strokes} 畫，${n.label}`);
    jie.push(`命名犯沖：${shown.join('；')}${badNames.length > 3 ? `；等 ${badNames.length} 個` : ''}。宜擇吉名。`);
  }
  return {
    ...base,
    grade,
    gradeName: GRADE_NAMES[grade],
    score,
    poem,
    poemTitle: `第${chineseNumber(poem.no)}籤　${GRADE_NAMES[grade]}`,
    jie,
  };
}

export { LUCK_NAMES };
