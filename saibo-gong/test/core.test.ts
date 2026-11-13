import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { throwPoe, judge } from '../src/core/poe.ts';
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

test('擲筊：機率約為 1/2、1/4、1/4', () => {
  const n = 40000;
  const c = { sheng: 0, xiao: 0, yin: 0 };
  for (let i = 0; i < n; i++) c[throwPoe().result]++;
  assert.ok(Math.abs(c.sheng / n - 0.5) < 0.02, `聖筊 ${c.sheng / n}`);
  assert.ok(Math.abs(c.xiao / n - 0.25) < 0.02, `笑筊 ${c.xiao / n}`);
  assert.ok(Math.abs(c.yin / n - 0.25) < 0.02, `陰筊 ${c.yin / n}`);
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
  assert.deepEqual(new Store(dir).getStats(), { throws: 2, sheng: 1, xiao: 0, yin: 1 });
  rmSync(dir, { recursive: true });
});
