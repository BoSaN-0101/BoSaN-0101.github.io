import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { throwPoe, judge, SHENG_CHANCE } from '../src/core/poe.ts';
import { Ledger } from '../src/core/ledger.ts';
import { CONFESSIONS, CONFESSION_LENGTHS, pickConfession, isConfessionComplete, correctPrefixLength } from '../src/core/confession.ts';
import { Store } from '../src/core/store.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'saibo-'));
const input = (n: number) => ({ feature: '主殿', action: '閉廟', target: `第${n}次`, confession: '' });

test('擲筊：判定規則', () => {
  assert.equal(judge(['flat', 'round']), 'sheng');
  assert.equal(judge(['round', 'flat']), 'sheng');
  assert.equal(judge(['flat', 'flat']), 'xiao');
  assert.equal(judge(['round', 'round']), 'yin');
});

test('擲筊：機率符合設定（聖筊 SHENG_CHANCE，笑筊陰筊平分其餘）', () => {
  const n = 40000;
  const c = { sheng: 0, xiao: 0, yin: 0 };
  for (let i = 0; i < n; i++) c[throwPoe().result]++;
  assert.ok(Math.abs(c.sheng / n - SHENG_CHANCE) < 0.02, `聖筊 ${c.sheng / n}`);
  assert.ok(Math.abs(c.xiao / n - (1 - SHENG_CHANCE) / 2) < 0.02, `笑筊 ${c.xiao / n}`);
  assert.ok(Math.abs(c.yin / n - (1 - SHENG_CHANCE) / 2) < 0.02, `陰筊 ${c.yin / n}`);
});

test('功過簿：正常新增後驗證通過', () => {
  const dir = tmp();
  const l = new Ledger(dir);
  assert.equal(l.verify().ok, true);
  for (let i = 1; i <= 3; i++) l.append(input(i));
  const v = new Ledger(dir).verify();
  assert.equal(v.ok, true);
  assert.equal(v.entries.length, 3);
  assert.equal(v.entries[2].prevHash, v.entries[1].hash);
  rmSync(dir, { recursive: true });
});

test('功過簿：改內容會被偵測', () => {
  const dir = tmp();
  const l = new Ledger(dir);
  for (let i = 1; i <= 3; i++) l.append(input(i));
  writeFileSync(l.file, readFileSync(l.file, 'utf8').replace('第2次', '沒這回事'));
  const v = l.verify();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 2);
  rmSync(dir, { recursive: true });
});

test('功過簿：刪掉中間一筆、砍掉尾巴、整個刪除都會被偵測', () => {
  for (const mutate of [
    (lines: string[]) => [lines[0], lines[2]],
    (lines: string[]) => [lines[0], lines[1]],
    () => [] as string[],
  ]) {
    const dir = tmp();
    const l = new Ledger(dir);
    for (let i = 1; i <= 3; i++) l.append(input(i));
    const lines = readFileSync(l.file, 'utf8').trim().split('\n');
    const out = mutate(lines);
    writeFileSync(l.file, out.length ? out.join('\n') + '\n' : '');
    assert.equal(l.verify().ok, false);
    rmSync(dir, { recursive: true });
  }
});

test('功過簿：竄改後繼續新增也不會被洗白', () => {
  const dir = tmp();
  const l = new Ledger(dir);
  for (let i = 1; i <= 2; i++) l.append(input(i));
  writeFileSync(l.file, readFileSync(l.file, 'utf8').replace('第1次', 'X'));
  l.append(input(3));
  assert.equal(l.verify().ok, false);
  rmSync(dir, { recursive: true });
});

test('功過簿：寫入一筆後、封印更新前中斷，不算竄改', () => {
  const dir = tmp();
  const l = new Ledger(dir);
  l.append(input(1));
  const head = readFileSync(l.headFile, 'utf8');
  l.append(input(2));
  writeFileSync(l.headFile, head);
  assert.equal(l.verify().ok, true);
  rmSync(dir, { recursive: true });
});

test('懺悔文：短中長各有兩版，抽到的長度和設定一致', () => {
  for (const l of CONFESSION_LENGTHS) {
    assert.equal(CONFESSIONS.filter((c) => c.length === l.id).length, 2);
    for (let i = 0; i < 20; i++) assert.equal(pickConfession(l.id).length, l.id);
  }
  assert.equal(pickConfession().length, 'medium');
});

test('懺悔文：要逐字相同，長度落在各級距', () => {
  const range = { short: [28, 42], medium: [65, 95], long: [130, 170] };
  for (const c of CONFESSIONS) {
    const [lo, hi] = range[c.length];
    assert.ok(c.text.length >= lo && c.text.length <= hi, `${c.id} 長度 ${c.text.length}`);
    assert.equal(isConfessionComplete(c.id, c.text), true);
    assert.equal(isConfessionComplete(c.id, c.text + '\n'), true);
    assert.equal(isConfessionComplete(c.id, c.text.slice(0, -1)), false);
    assert.equal(isConfessionComplete(c.id, c.text.replace('，', ',')), false);
    assert.equal(correctPrefixLength(c.text, c.text.slice(0, 5) + '錯'), 5);
  }
});

test('統計：擲筊結果會累計', () => {
  const dir = tmp();
  const s = new Store(dir);
  s.recordThrow('sheng');
  s.recordThrow('yin');
  assert.deepEqual(new Store(dir).getStats(), { throws: 2, sheng: 1, xiao: 0, yin: 1, pushes: 0, pushBlessed: 0, pushDefied: 0, pushAbandoned: 0, pushAbsent: 0 });
  rmSync(dir, { recursive: true });
});

import { getAlmanac, toTraditional } from '../src/core/almanac.ts';
import { parsePrePushInput, releaseTargets, parseBranchList, repoName } from '../src/core/push.ts';

test('農民曆：轉成繁體，並判斷忌開市', () => {
  const a = getAlmanac(new Date(2026, 10, 13));
  assert.equal(a.lunar, '丙午年（馬）十月初五');
  assert.ok(a.yi.includes('開市'));
  assert.equal(a.jiKaishi, false);
  assert.equal(toTraditional('开市 纳财 修坟'), '開市 納財 修墳');
  // 六年內每一天的宜忌都不能殘留常見簡體字，而且確實有忌開市的日子
  let ji = 0;
  for (let d = new Date(2024, 0, 1); d < new Date(2030, 0, 1); d.setDate(d.getDate() + 1)) {
    const x = getAlmanac(d);
    if (x.jiKaishi) ji++;
    assert.doesNotMatch([...x.yi, ...x.ji, x.lunar].join(''), /[开纳进动门马无财产发种谢启坟斋订车庙归宁学医竖盖丧会亲机涂馀桥绘坏诸猎仓帐经络扫挂补渔饰墙养厕针货词讼结网佣寿习艺筑问断蚁龙鸡闰腊殓钻]/);
  }
  assert.ok(ji > 300);
});

test('push：解析 hook 輸入並判斷是否正式上線', () => {
  const z = '0'.repeat(40);
  const refs = parsePrePushInput(`refs/heads/dev ${z} refs/heads/dev ${z}\nrefs/heads/main ${z} refs/heads/main ${z}\r\nrefs/tags/v1 ${z} refs/tags/v1 ${z}\n\n`);
  assert.equal(refs.length, 3);
  assert.deepEqual(releaseTargets(refs, ['main', 'master']), ['分支 main', 'tag v1']);
  assert.deepEqual(releaseTargets(refs.slice(0, 1), ['main']), []);
  assert.deepEqual(parseBranchList('main, master，release  prod'), ['main', 'master', 'release', 'prod']);
  assert.equal(repoName('C:\\Users\\x\\my repo\\'), 'my repo');
});

import { POEMS, GRADE_ORDER, drawPoem, chineseNumber } from '../src/core/fortune-poems.ts';
import { gradeOf, jieFor } from '../src/core/fortune.ts';
import { parseDiff } from '../src/core/diff.ts';
import { parseCppcheck, ruffSeverity, langOf } from '../src/core/linters.ts';
import { strokesOf, readName, reduce81, declaredNames } from '../src/core/nameology.ts';

test('籤詩庫：每個籤等至少十支，每支四句七言，沒有重複', () => {
  for (const g of GRADE_ORDER) assert.ok(POEMS.filter((p) => p.grade === g).length >= 10, g);
  const seen = new Set<string>();
  for (const p of POEMS) {
    assert.equal(p.lines.length, 4);
    for (const l of p.lines) {
      assert.equal([...l].length, 7, `第 ${p.no} 籤「${l}」不是七個字`);
      assert.ok(!seen.has(l), `重複的句子：${l}`);
      seen.add(l);
    }
    assert.equal(drawPoem(p.grade, () => 0).grade, p.grade);
  }
  assert.equal(chineseNumber(7), '七');
  assert.equal(chineseNumber(12), '十二');
  assert.equal(chineseNumber(50), '五十');
});

test('籤等：依加權問題密度決定，有錯誤等級就不會好過中平', () => {
  const s = (severity: 'error' | 'warning' | 'style', n: number) => Array.from({ length: n }, () => ({ severity }));
  assert.equal(gradeOf([], 100).grade, 'shangshang');
  assert.equal(gradeOf(s('style', 2), 100).grade, 'shangji');
  assert.equal(gradeOf(s('warning', 1), 100).grade, 'zhongji');
  assert.equal(gradeOf(s('warning', 3), 100).grade, 'zhongping');
  assert.equal(gradeOf(s('warning', 4), 100).grade, 'xiaxia');
  assert.equal(gradeOf(s('error', 1), 1000).grade, 'zhongping');
  assert.equal(gradeOf(s('error', 3), 5000).grade, 'xiaxia');
});

test('diff：解析新增的行號', () => {
  const d = parseDiff(['diff --git a/a.cpp b/a.cpp', '--- a/a.cpp', '+++ b/a.cpp', '@@ -3,0 +4,2 @@', '+int x;', '+int y;', '@@ -10 +12 @@', '-old', '+new',
    'diff --git a/gone.py b/gone.py', '--- a/gone.py', '+++ /dev/null', '@@ -1 +0,0 @@', '-x'].join('\n'));
  assert.deepEqual([...d.get('a.cpp')!.lines], [4, 5, 12]);
  assert.deepEqual(d.get('a.cpp')!.added, ['int x;', 'int y;', 'new']);
  assert.equal(d.has('gone.py'), false);
});

test('檢查工具：解析輸出、判斷語言與嚴重度', () => {
  const list = parseCppcheck('bad.cpp\t7\terror\tmemleak\tMemory leak: p\nnoise\nbad.cpp\t3\tstyle\tunusedVariable\tUnused variable: x\n');
  assert.deepEqual(list.map((i) => [i.line, i.severity, i.id]), [[7, 'error', 'memleak'], [3, 'style', 'unusedVariable']]);
  assert.equal(langOf('src/a.CPP'), 'cpp');
  assert.equal(langOf('x.tsx'), 'js');
  assert.equal(langOf('README.md'), null);
  assert.equal(ruffSeverity('F821'), 'error');
  assert.equal(ruffSeverity('F401'), 'warning');
  assert.equal(ruffSeverity('E501'), 'style');
  assert.match(jieFor({ tool: 'cppcheck', file: 'a.cpp', line: 7, severity: 'error', id: 'memleak', message: 'Memory leak: p' }), /^a\.cpp 第 7 行：.*(孤魂野鬼|財氣外洩)/);
});

test('變數姓名學：筆畫、八十一數理、找出宣告的名字', () => {
  const table = { A: 3, B: 3, C: 1, T: 2, M: 4, P: 2, '2': 1 };
  assert.equal(strokesOf('abc', table), 7);
  assert.equal(strokesOf('tmp2', table), 9);
  assert.equal(strokesOf('a_b', table), 6);
  assert.equal(strokesOf('變數', table), 38);
  assert.equal(strokesOf('___', table), null);
  assert.equal(readName('tmp2', table)!.luck, 'xiong');
  assert.equal(reduce81(81), 81);
  assert.equal(reduce81(82), 2);
  assert.equal(reduce81(161), 81);
  assert.deepEqual(declaredNames('cpp', ['int* leak = new int[10];', 'std::vector<int> items;', 'void doThing(int count) {', '  return leak;', 'class Widget {']).sort(),
    ['Widget', 'count', 'doThing', 'items', 'leak']);
  assert.deepEqual(declaredNames('python', ['def run(x):', 'total = 0', 'for item in xs:', '    if total == 3:  # hi']).sort(), ['item', 'run', 'total']);
  assert.deepEqual(declaredNames('js', ['const a = 1, b = 2;', 'function go() {', 'let 計數 = 0;']).sort(), ['a', 'go', '計數']);
});
