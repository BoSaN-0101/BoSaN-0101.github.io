// git 的 pre-push hook 呼叫的小程式（用 Electron 的「當成 Node 執行」模式跑，不開視窗）。
// 它去問主殿這次 push 准不准：結束碼 0 = 放行，1 = 擋下。
// 最重要的原則：絕不能讓 git 卡死。App 沒開就試著啟動；等不到回應就放行，並在功過簿記一筆「神明不在」。

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { dataDir, serverFile } from '../core/paths.ts';
import { Ledger } from '../core/ledger.ts';
import { Store } from '../core/store.ts';
import { parsePrePushInput, repoName, type PushInfo } from '../core/push.ts';

const ALLOW = 0;
const DENY = 1;
const WAIT_APP_MS = Number(process.env.SAIBO_HOOK_WAIT_MS) || 20000;
const POLL_MS = 500;

const dir = dataDir();
const say = (msg: string) => process.stderr.write(`【賽博宮】${msg}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ServerInfo {
  port: number;
  token: string;
}

function readServer(): ServerInfo | null {
  try {
    const s = JSON.parse(readFileSync(serverFile(dir), 'utf8'));
    return typeof s.port === 'number' && typeof s.token === 'string' ? s : null;
  } catch {
    return null;
  }
}

function call<T>(s: ServerInfo, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port: s.port,
        path,
        method,
        timeout: 4000,
        headers: { 'x-saibo-token': s.token, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) },
      },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function alive(s: ServerInfo | null): Promise<boolean> {
  if (!s) return false;
  try {
    await call(s, 'GET', '/ping');
    return true;
  } catch {
    return false;
  }
}

function startApp(): void {
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    // 開發時要把專案資料夾交給 Electron；打包後執行檔本身就是 App。
    const appRoot = join(__dirname, '..');
    const args = __dirname.includes('app.asar') ? [] : [appRoot];
    if (process.env.SAIBO_ELECTRON_ARGS) args.push(...process.env.SAIBO_ELECTRON_ARGS.split(' '));
    spawn(process.execPath, args, { detached: true, stdio: 'ignore', env, windowsHide: false }).unref();
  } catch {
    /* 啟動不了就等逾時放行 */
  }
}

async function connect(): Promise<ServerInfo | null> {
  let s = readServer();
  if (await alive(s)) return s;
  say('主殿沒開，正在請神……');
  startApp();
  const deadline = Date.now() + WAIT_APP_MS;
  while (Date.now() < deadline) {
    await sleep(400);
    s = readServer();
    if (await alive(s)) return s;
  }
  return null;
}

function absent(repo: string, why: string): number {
  try {
    new Ledger(dir).append({ feature: '擲筊 push', action: '神明不在', target: repo, confession: '' });
    new Store(dir).recordPush('pushAbsent');
  } catch {
    /* 記不了也不能擋 push */
  }
  say(`神明不在（${why}），這次放行，已記入功過簿。`);
  return ALLOW;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(buf));
  });
}

async function prePush(remote: string, url: string): Promise<number> {
  const refs = parsePrePushInput(await readStdin());
  if (refs.length === 0) return ALLOW;

  // 閉廟、或兩個功能都關掉時，不必打擾主殿。
  const settings = new Store(dir).getSettings();
  if (settings.closed) return ALLOW;
  if (settings.features.poePush === false && settings.features.almanac === false) return ALLOW;

  let repoPath = process.cwd();
  try {
    repoPath = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true }).trim() || repoPath;
  } catch {
    /* 用目前資料夾 */
  }
  const repo = repoName(repoPath);
  const info: PushInfo = { repoPath, remote, url, refs };

  const server = await connect();
  if (!server) return absent(repo, '主殿沒有回應');

  let id: string;
  try {
    const r = await call<{ done?: boolean; allow?: boolean; message?: string; id?: string }>(server, 'POST', '/prepush', info);
    if (r.done) {
      if (r.message) say(r.message);
      return r.allow === false ? DENY : ALLOW;
    }
    id = r.id!;
  } catch {
    return absent(repo, '主殿沒有回應');
  }

  say('請到主殿，按規矩來。（在這裡按 Ctrl+C 可以取消 push）');
  let failures = 0;
  for (;;) {
    await sleep(POLL_MS);
    try {
      const r = await call<{ state: string; allow?: boolean; message?: string }>(server, 'GET', `/status?id=${encodeURIComponent(id)}`);
      failures = 0;
      if (r.state === 'done') {
        if (r.message) say(r.message);
        return r.allow ? ALLOW : DENY;
      }
    } catch {
      if (++failures >= 6) return absent(repo, '主殿中途沒了回應');
    }
  }
}

async function main(): Promise<number> {
  const [cmd, remote = '', url = ''] = process.argv.slice(2);
  if (cmd === 'pre-push') return prePush(remote, url);
  return ALLOW;
}

// 任何意外都放行：這個工具不能成為 push 不出去的原因。
process.on('uncaughtException', () => process.exit(ALLOW));
process.on('unhandledRejection', () => process.exit(ALLOW));
main().then(
  (code) => process.exit(code),
  () => process.exit(ALLOW),
);
