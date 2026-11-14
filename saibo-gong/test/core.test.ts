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

import { Underworld } from '../src/core/underworld.ts';
import { findScared, shoujingText } from '../src/core/shoujing.ts';
import { findGhosts, exclusionReason, type Proc } from '../src/core/pudu.ts';
import { mkdirSync as mk, existsSync as ex } from 'node:fs';

test('陰間：燒進去、還陽回原位、同名改名、原位置回不去也一定成功', () => {
  const root = tmp();
  const uw = new Underworld({ dir: join(root, 'uw'), fallbackDir: join(root, 'fallback'), protectedDirs: [join(root, 'sys')] });
  mk(join(root, 'docs', 'sub'), { recursive: true });
  mk(join(root, 'sys'));
  writeFileSync(join(root, 'docs', 'a.txt'), 'hello');
  writeFileSync(join(root, 'docs', 'sub', 'b.txt'), 'inner');
  writeFileSync(join(root, 'sys', 'x.dll'), 'x');

  const soul = uw.burn(join(root, 'docs', 'a.txt'));
  assert.equal(ex(join(root, 'docs', 'a.txt')), false);
  assert.equal(readFileSync(uw.pathOf(soul), 'utf8'), 'hello');
  assert.equal(uw.list().length, 1);
  let r = uw.restore(soul.id);
  assert.equal(r.restoredTo, join(root, 'docs', 'a.txt'));
  assert.equal(readFileSync(r.restoredTo, 'utf8'), 'hello');
  assert.equal(uw.list().length, 0);

  // 原位置已經有同名檔案 → 改名，不覆蓋
  const s2 = uw.burn(join(root, 'docs', 'a.txt'));
  writeFileSync(join(root, 'docs', 'a.txt'), 'newer');
  r = uw.restore(s2.id);
  assert.equal(r.restoredTo, join(root, 'docs', 'a（還陽）.txt'));
  assert.equal(readFileSync(join(root, 'docs', 'a.txt'), 'utf8'), 'newer');

  // 整個資料夾也能燒；原本的上層資料夾被改成檔案（回不去）→ 放到備用位置
  const s3 = uw.burn(join(root, 'docs', 'sub'));
  assert.equal(s3.isDir, true);
  rmSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs'), 'now a file');
  r = uw.restore(s3.id);
  assert.equal(r.relocated, true);
  assert.equal(readFileSync(join(root, 'fallback', 'sub', 'b.txt'), 'utf8'), 'inner');

  // 不准燒的東西
  assert.throws(() => uw.burn(join(root, 'sys', 'x.dll')), /不能燒/);
  assert.throws(() => uw.burn(join(root, 'uw')), /不能燒/);
  assert.throws(() => uw.burn(root), /不能燒/);
  assert.throws(() => uw.burn(join(root, 'nope')), /找不到/);

  // 超過期限的才提議超渡
  writeFileSync(join(root, 'old.txt'), 'old');
  const s4 = uw.burn(join(root, 'old.txt'), new Date(Date.now() - 31 * 86400000));
  assert.deepEqual(uw.overdue(30).map((s) => s.id), [s4.id]);
  assert.equal(uw.overdue(40).length, 0);
  rmSync(root, { recursive: true });
});

test('收驚：一小時內當三次才算被嚇到，收過的不再提', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  const at = (min: number, name = 'Foo.exe') => ({ time: new Date(now.getTime() - min * 60000).toISOString(), name, module: 'bar.dll', code: 'c0000005', path: `C:\\Apps\\${name}` });
  assert.equal(findScared([at(5), at(20)], now).length, 0);
  assert.equal(findScared([at(5), at(20), at(70)], now).length, 0);
  const s = findScared([at(5), at(20), at(50, 'foo.exe'), at(10, 'Other.exe')], now);
  assert.equal(s.length, 1);
  assert.equal(s[0].count, 3);
  assert.equal(s[0].path, 'C:\\Apps\\Foo.exe');
  assert.equal(findScared([at(5), at(20), at(50)], now, [s[0].key]).length, 0);
  assert.equal(findScared([at(1), at(5), at(20), at(50)], now, [s[0].key]).length, 1);
  assert.ok(shoujingText('Foo.exe').join('').includes('Foo.exe'));
});

test('普渡：只挑沒回應或久未活動的，系統、服務、防毒、自己、白名單一律排除', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  const ctx = { now, systemRoot: 'C:\\Windows', selfPids: [999], selfPath: 'C:\\Apps\\saibo\\electron.exe', whitelist: ['keepme'] };
  const p = (o: Partial<Proc>): Proc => ({ pid: 1, name: 'app', path: 'C:\\Apps\\app.exe', mySession: true, hasWindow: false, title: '', responding: true,
    start: new Date(now.getTime() - 5 * 3600000).toISOString(), cpu: 1, service: false, ...o });
  const ghosts = findGhosts([
    p({ pid: 10, name: 'frozen', hasWindow: true, responding: false }),
    p({ pid: 11, name: 'idlebg' }),
    p({ pid: 12, name: 'busybg', cpu: 600 }),
    p({ pid: 13, name: 'newbg', start: new Date(now.getTime() - 600000).toISOString() }),
    p({ pid: 14, name: 'fine', hasWindow: true }),
    p({ pid: 15, name: 'notepad', path: 'C:\\Windows\\System32\\notepad.exe', hasWindow: true, responding: false }),
    p({ pid: 16, name: 'svc', service: true }),
    p({ pid: 17, name: 'MsMpEng', path: 'C:\\ProgramData\\Microsoft\\Windows Defender\\Platform\\MsMpEng.exe' }),
    p({ pid: 999, name: 'electron' }),
    p({ pid: 18, name: 'electron', path: 'C:\\Apps\\saibo\\electron.exe' }),
    p({ pid: 19, name: 'KeepMe.exe' }),
    p({ pid: 20, name: 'other', mySession: false }),
    p({ pid: 21, name: 'nopath', path: null }),
  ], ctx);
  assert.deepEqual(ghosts.map((g) => [g.pid, g.kind]), [[10, 'hung'], [11, 'lingering']]);
  assert.equal(exclusionReason(p({ name: 'avastui', path: 'C:\\Program Files\\Avast Software\\Avast\\AvastUI.exe' }), ctx), '防毒軟體');
});

test('農民曆：認得農曆七月和中元正日', () => {
  assert.equal(getAlmanac(new Date(2026, 7, 27)).zhongyuan, true);
  assert.equal(getAlmanac(new Date(2026, 7, 27)).ghostMonth, true);
  assert.equal(getAlmanac(new Date(2026, 10, 14)).ghostMonth, false);
});

import { parseExpiry, checkGreen, guaiguaiStatus, isValidDate } from '../src/core/guaiguai.ts';

test('綠色乖乖：從文字讀出有效日期（取最晚的）', () => {
  assert.equal(parseExpiry('40s FH) 2026.05.20 | AEN 2027.03.15 |'), '2027-03-15');
  assert.equal(parseExpiry('EXP 2027/6/5'), '2027-06-05');
  assert.equal(parseExpiry('有效日期 2027年3月1日'), '2027-03-01');
  assert.equal(parseExpiry('LOT 20270930 A1'), '2027-09-30');
  assert.equal(parseExpiry('2027.02.30 1999.01.01 tel 0912345678'), null);
  assert.equal(parseExpiry('乖乖'), null);
  assert.equal(isValidDate('2027-03-15'), true);
  assert.equal(isValidDate('2027-13-01'), false);
});

test('綠色乖乖：主色要是綠色，其他口味不算', () => {
  const img = (r: number, g: number, b: number) => {
    const d = new Uint8ClampedArray(100 * 100 * 4);
    for (let i = 0; i < d.length; i += 4) {
      const edge = (i / 4) % 100 < 10; // 一點灰色背景
      d[i] = edge ? 200 : r; d[i + 1] = edge ? 200 : g; d[i + 2] = edge ? 200 : b; d[i + 3] = 255;
    }
    return d;
  };
  assert.equal(checkGreen(img(31, 157, 58), 100, 100).green, true);
  assert.equal(checkGreen(img(242, 194, 26), 100, 100).green, false);
  assert.equal(checkGreen(img(242, 194, 26), 100, 100).dominant, '黃色');
  assert.equal(checkGreen(img(200, 30, 30), 100, 100).green, false);
  assert.equal(checkGreen(img(230, 230, 230), 100, 100).green, false);
});

test('綠色乖乖：有效日期當天還有效，隔天才過期', () => {
  const today = new Date(2026, 10, 14, 15, 30);
  assert.deepEqual(guaiguaiStatus('2026-11-14', today), { registered: true, expiry: '2026-11-14', daysLeft: 0, expired: false });
  assert.equal(guaiguaiStatus('2026-11-13', today).expired, true);
  assert.equal(guaiguaiStatus('2026-11-13', today).daysLeft, -1);
  assert.equal(guaiguaiStatus('2027-03-15', today).daysLeft, 121);
  assert.equal(guaiguaiStatus('', today).registered, false);
});
