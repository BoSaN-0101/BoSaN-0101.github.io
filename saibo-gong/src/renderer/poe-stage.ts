// 擲筊的演出：按住筊、甩出去放開，筊翻滾落地。
// 結果在動畫開始前就由主程序決定好了，這裡只負責把它「演」出來：
// 先把整段拋物線和彈跳算完，再讓翻面的角度剛好在落定時停在指定的那一面。

import type { PoeFace, PoeThrow } from '../core/poe.ts';

const W = 720;
const H = 460;
const FLOOR = 392;
const GRAVITY = 2600;
const DT = 1 / 120;

interface Body {
  path: Float32Array; // 每一格的 x, y
  frames: number;
  flipTotal: number; // 總共翻幾弧度
  spinFrom: number;
  spinTo: number;
  floorY: number;
  face: PoeFace; // 最後朝上的面
}

interface Pose {
  x: number;
  y: number;
  spin: number;
  flip: number;
  floorY: number;
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function simulate(x: number, y: number, vx: number, vy: number, floorY: number, face: PoeFace): Body {
  const pts: number[] = [];
  let bounces = 0;
  for (let i = 0; i < 6 / DT; i++) {
    vy += GRAVITY * DT;
    x += vx * DT;
    y += vy * DT;
    if (x < 70) { x = 70; vx = Math.abs(vx) * 0.5; }
    if (x > W - 70) { x = W - 70; vx = -Math.abs(vx) * 0.5; }
    if (y < 30) { y = 30; vy = Math.abs(vy) * 0.4; }
    if (y >= floorY) {
      y = floorY;
      if (Math.abs(vy) > 90) {
        vy = -vy * 0.42;
        vx *= 0.7;
        bounces++;
      } else {
        vy = 0;
        vx *= 0.9;
        if (Math.abs(vx) < 10 && bounces > 0) { pts.push(x, y); break; }
        bounces = Math.max(bounces, 1);
      }
    }
    pts.push(x, y);
  }
  // 一開始是平面朝上；要停在凸面就多翻半圈。
  const flips = 2 + Math.floor(Math.random() * 3);
  const dir = Math.random() < 0.5 ? -1 : 1;
  return {
    path: Float32Array.from(pts),
    frames: pts.length / 2,
    flipTotal: Math.PI * (2 * flips + (face === 'round' ? 1 : 0)),
    spinFrom: rand(-0.3, 0.3),
    spinTo: rand(-0.6, 0.6) + dir * Math.PI * 2 * (1 + Math.floor(Math.random() * 2)),
    floorY,
    face,
  };
}

export class PoeStage {
  /** 使用者甩出去（或按了代擲）時呼叫；要回傳這次的結果。回傳 null 表示現在不能擲。 */
  onThrow: (() => Promise<PoeThrow | null>) | null = null;
  /** 筊落定之後呼叫。 */
  onLanded: ((t: PoeThrow) => void) | null = null;
  onGrab: (() => void) | null = null;
  enabled = true;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private state: 'idle' | 'drag' | 'wait' | 'fly' = 'idle';
  private rest: [Pose, Pose];
  private bodies: [Body, Body] | null = null;
  private current: PoeThrow | null = null;
  private t0 = 0;
  private hand = { x: W / 2, y: 330 };
  private samples: { x: number; y: number; t: number }[] = [];
  private held: [Pose, Pose];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    this.ctx.scale(dpr, dpr);
    this.rest = this.homePose();
    this.held = this.homePose();
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', () => this.cancel());
    this.draw();
  }

  get busy(): boolean {
    return this.state === 'wait' || this.state === 'fly';
  }

  private homePose(): [Pose, Pose] {
    return [
      { x: W / 2 - 62, y: FLOOR - 4, spin: -0.25, flip: 0, floorY: FLOOR - 4 },
      { x: W / 2 + 62, y: FLOOR + 6, spin: 0.25 + Math.PI, flip: 0, floorY: FLOOR + 6 },
    ];
  }

  /** 把筊收回原位，準備下一擲。 */
  reset(): void {
    if (this.busy) return;
    this.state = 'idle';
    this.bodies = null;
    this.rest = this.homePose();
    this.draw();
  }

  /** 不拖曳，直接代擲一次。 */
  autoThrow(): void {
    if (this.busy || !this.enabled) return;
    this.hand = { x: W / 2 + rand(-40, 40), y: 300 };
    void this.launch(rand(-260, 260), rand(-1150, -850));
  }

  private pos(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }

  private down(e: PointerEvent): void {
    if (this.busy || !this.enabled) return;
    // 在神桌前任何地方按下都能拿起筊：筊落地後可能彈到很遠，不必先去找它。
    const p = this.pos(e);
    this.held = [{ ...this.rest[0] }, { ...this.rest[1] }];
    // 把角度收到離目標最近的那一圈，免得拿起來時多轉好幾圈。
    const TAU = Math.PI * 2;
    const wrap = (a: number) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
    this.held[0].spin = -0.2 + wrap(this.held[0].spin + 0.2);
    this.held[1].spin = 0.2 + Math.PI + wrap(this.held[1].spin - 0.2 - Math.PI);
    for (const h of this.held) h.flip = wrap(h.flip);
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.classList.add('grabbing');
    this.state = 'drag';
    this.hand = p;
    this.samples = [{ ...p, t: performance.now() }];
    this.onGrab?.();
    requestAnimationFrame(() => this.gather());
  }

  /** 拿著的時候，筊從落地的位置滑到手上。 */
  private gather(): void {
    if (this.state !== 'drag' && this.state !== 'wait') return;
    const targets = this.handPoses();
    this.held.forEach((h, i) => {
      const t = targets[i];
      h.x += (t.x - h.x) * 0.3;
      h.y += (t.y - h.y) * 0.3;
      h.spin += (t.spin - h.spin) * 0.3;
      h.flip += (0 - h.flip) * 0.3;
    });
    this.draw();
    requestAnimationFrame(() => this.gather());
  }

  private handPoses(): [Pose, Pose] {
    return [
      { x: this.hand.x - 34, y: this.hand.y, spin: -0.2, flip: 0, floorY: FLOOR },
      { x: this.hand.x + 34, y: this.hand.y, spin: 0.2 + Math.PI, flip: 0, floorY: FLOOR },
    ];
  }

  private move(e: PointerEvent): void {
    if (this.state !== 'drag') return;
    const p = this.pos(e);
    this.hand = { x: clamp(p.x, 70, W - 70), y: clamp(p.y, 40, FLOOR) };
    const now = performance.now();
    this.samples.push({ ...p, t: now });
    while (this.samples.length > 2 && now - this.samples[0].t > 90) this.samples.shift();
  }

  private up(_e: PointerEvent): void {
    if (this.state !== 'drag') return;
    this.canvas.classList.remove('grabbing');
    const a = this.samples[0];
    const b = this.samples[this.samples.length - 1];
    const dt = Math.max((b.t - a.t) / 1000, 0.016);
    let vx = (b.x - a.x) / dt;
    let vy = (b.y - a.y) / dt;
    // 沒甩出力道（只是點一下）就幫忙往上拋。
    if (Math.hypot(vx, vy) < 250) { vx = rand(-200, 200); vy = -900; }
    const speed = Math.hypot(vx, vy);
    if (speed > 2000) { vx *= 2000 / speed; vy *= 2000 / speed; }
    void this.launch(vx, vy);
  }

  private cancel(): void {
    if (this.state !== 'drag') return;
    this.canvas.classList.remove('grabbing');
    this.state = 'idle';
    this.rest = this.homePose();
    this.draw();
  }

  private async launch(vx: number, vy: number): Promise<void> {
    this.state = 'wait';
    let result: PoeThrow | null = null;
    try {
      result = (await this.onThrow?.()) ?? null;
    } catch {
      result = null;
    }
    if (!result) {
      this.state = 'idle';
      this.rest = this.homePose();
      this.draw();
      return;
    }
    this.current = result;
    const { x, y } = this.hand;
    this.bodies = [
      simulate(x - 34, y, vx + rand(-160, 40), vy + rand(-120, 120), FLOOR - rand(0, 14), result.faces[0]),
      simulate(x + 34, y, vx + rand(-40, 160), vy + rand(-120, 120), FLOOR + rand(0, 14), result.faces[1]),
    ];
    this.state = 'fly';
    this.t0 = performance.now();
    requestAnimationFrame(() => this.tick());
  }

  private poseAt(b: Body, sec: number): Pose {
    const f = clamp(Math.floor(sec / DT), 0, b.frames - 1);
    const k = easeOut(clamp(sec / (b.frames * DT), 0, 1));
    return {
      x: b.path[f * 2],
      y: b.path[f * 2 + 1],
      spin: b.spinFrom + (b.spinTo - b.spinFrom) * k,
      flip: b.flipTotal * k,
      floorY: b.floorY,
    };
  }

  private tick(): void {
    if (this.state !== 'fly' || !this.bodies) return;
    const sec = (performance.now() - this.t0) / 1000;
    this.rest = [this.poseAt(this.bodies[0], sec), this.poseAt(this.bodies[1], sec)];
    this.draw();
    const total = Math.max(this.bodies[0].frames, this.bodies[1].frames) * DT;
    if (sec < total) {
      requestAnimationFrame(() => this.tick());
    } else {
      this.state = 'idle';
      if (this.current) this.onLanded?.(this.current);
    }
  }

  private draw(): void {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    const poses: Pose[] =
      this.state === 'drag' || this.state === 'wait' ? this.held : this.rest;
    for (const p of poses) {
      const lift = clamp((p.floorY - p.y) / 300, 0, 1);
      c.fillStyle = `rgba(0,0,0,${0.38 * (1 - lift * 0.7)})`;
      c.beginPath();
      c.ellipse(p.x, p.floorY + 24, 58 * (1 - lift * 0.4), 9 * (1 - lift * 0.4), 0, 0, Math.PI * 2);
      c.fill();
    }
    for (const p of poses) this.drawPoe(p);
  }

  private drawPoe(p: Pose): void {
    const c = this.ctx;
    const cos = Math.cos(p.flip);
    const flatUp = cos >= 0;
    c.save();
    c.translate(p.x, p.y);
    c.rotate(p.spin);
    c.scale(1, Math.max(Math.abs(cos), 0.1));
    c.beginPath();
    c.moveTo(-60, 14);
    c.quadraticCurveTo(0, -78, 60, 14);
    c.quadraticCurveTo(0, -14, -60, 14);
    c.closePath();
    if (flatUp) {
      // 平面：淺色木紋
      c.fillStyle = '#e0a070';
      c.fill();
      c.lineWidth = 5;
      c.strokeStyle = '#a3261a';
      c.stroke();
      c.lineWidth = 1.2;
      c.strokeStyle = 'rgba(120,60,30,.55)';
      c.beginPath();
      c.moveTo(-38, 0);
      c.quadraticCurveTo(0, -42, 38, 0);
      c.stroke();
    } else {
      // 凸面：紅漆加反光
      const g = c.createLinearGradient(0, -50, 0, 14);
      g.addColorStop(0, '#e2422f');
      g.addColorStop(1, '#8a1a10');
      c.fillStyle = g;
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = '#5c0f08';
      c.stroke();
      c.strokeStyle = 'rgba(255,255,255,.5)';
      c.lineWidth = 4;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(-28, -18);
      c.quadraticCurveTo(0, -44, 28, -18);
      c.stroke();
    }
    c.restore();
  }
}
