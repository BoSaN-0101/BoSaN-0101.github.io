// 主殿這一側：只聽本機（127.0.0.1）的小伺服器，接 git hook 小程式送來的 push 請求。
// 一次只處理一個 push 儀式，其餘排隊。

import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { serverFile } from '../core/paths.ts';
import type { PushInfo } from '../core/push.ts';

export interface Decision {
  allow: boolean;
  message: string;
}

export interface PendingPush {
  id: string;
  info: PushInfo;
  lastSeen: number;
  decision: Decision | null;
}

export interface HookServerOptions {
  dataDir: string;
  /** 不必進主殿就能決定的情況（閉廟、功能沒開、不必擋）回傳決定；需要儀式就回傳 null。 */
  quickDecision(info: PushInfo): Decision | null;
  /** 開始一場儀式。 */
  onStart(p: PendingPush): void;
  /** hook 那一端不見了（使用者按了 Ctrl+C），儀式作廢。 */
  onVanish(p: PendingPush): void;
}

const VANISH_MS = 6000;

export class HookServer {
  private server: Server | null = null;
  private readonly token = randomBytes(16).toString('hex');
  private readonly pending = new Map<string, PendingPush>();
  private queue: PendingPush[] = [];
  private current: PendingPush | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly opt: HookServerOptions;

  constructor(opt: HookServerOptions) {
    this.opt = opt;
  }

  start(): void {
    this.server = createServer((req, res) => void this.handle(req, res));
    this.server.listen(0, '127.0.0.1', () => {
      const addr = this.server!.address();
      if (addr && typeof addr === 'object') {
        mkdirSync(this.opt.dataDir, { recursive: true });
        writeFileSync(serverFile(this.opt.dataDir), JSON.stringify({ port: addr.port, token: this.token, pid: process.pid }), 'utf8');
      }
    });
    this.timer = setInterval(() => this.sweep(), 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.server?.close();
    rmSync(serverFile(this.opt.dataDir), { force: true });
  }

  get active(): PendingPush | null {
    return this.current;
  }

  /** 儀式有了結果。 */
  resolve(id: string, decision: Decision): void {
    const p = this.pending.get(id);
    if (!p || p.decision) return;
    p.decision = decision;
    if (this.current?.id === id) {
      this.current = null;
      this.next();
    } else {
      this.queue = this.queue.filter((q) => q.id !== id);
    }
    // 留一小段時間讓 hook 來領結果，之後清掉。
    setTimeout(() => this.pending.delete(id), 60000).unref();
  }

  /** 全部放行（閉廟時用）。 */
  releaseAll(message: string): void {
    for (const p of [...this.pending.values()]) if (!p.decision) this.resolve(p.id, { allow: true, message });
  }

  private next(): void {
    if (this.current) return;
    const p = this.queue.shift();
    if (!p) return;
    this.current = p;
    this.opt.onStart(p);
  }

  private sweep(): void {
    const now = Date.now();
    for (const p of [...this.pending.values()]) {
      if (!p.decision && now - p.lastSeen > VANISH_MS) {
        this.opt.onVanish(p);
        this.resolve(p.id, { allow: false, message: '' });
      }
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.headers['x-saibo-token'] !== this.token) return send(403, {});
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/ping') return send(200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/status') {
        const p = this.pending.get(url.searchParams.get('id') ?? '');
        if (!p) return send(200, { state: 'done', allow: true, message: '' });
        p.lastSeen = Date.now();
        return send(200, p.decision ? { state: 'done', ...p.decision } : { state: 'pending' });
      }
      if (req.method === 'POST' && url.pathname === '/prepush') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const info = JSON.parse(body) as PushInfo;
        const quick = this.opt.quickDecision(info);
        if (quick) return send(200, { done: true, ...quick });
        const p: PendingPush = { id: randomBytes(8).toString('hex'), info, lastSeen: Date.now(), decision: null };
        this.pending.set(p.id, p);
        this.queue.push(p);
        send(200, { id: p.id });
        this.next();
        return;
      }
      send(404, {});
    } catch {
      send(400, {});
    }
  }
}
