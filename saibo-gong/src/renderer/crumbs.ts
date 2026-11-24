// 乖乖碎屑：偶爾從畫面上方掉下一陣碎屑。這個視窗透明、滑鼠可穿透，不影響任何操作。

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const fast = new URLSearchParams(location.search).has('fast');

interface Crumb { x: number; y: number; vy: number; vx: number; r: number; spin: number; a: number; color: string }
let crumbs: Crumb[] = [];
let running = false;

function resize(): void {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
}
addEventListener('resize', resize);
resize();

const COLORS = ['#e8b84a', '#d99a2b', '#f2cf73', '#c98522'];

function burst(): void {
  const n = 10 + Math.floor(Math.random() * 10);
  const cx = Math.random() * innerWidth;
  for (let i = 0; i < n; i++) {
    crumbs.push({
      x: cx + (Math.random() - 0.5) * 320,
      y: -10 - Math.random() * 120,
      vy: 90 + Math.random() * 140,
      vx: (Math.random() - 0.5) * 40,
      r: 3 + Math.random() * 5,
      spin: Math.random() * 6,
      a: Math.random() * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
  }
  if (!running) {
    running = true;
    last = performance.now();
    requestAnimationFrame(tick);
  }
}

let last = 0;
function tick(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const c of crumbs) {
    c.vy += 260 * dt;
    c.y += c.vy * dt;
    c.x += c.vx * dt;
    c.a += c.spin * dt;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.a);
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, c.r, c.r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  crumbs = crumbs.filter((c) => c.y < innerHeight + 20);
  if (crumbs.length) requestAnimationFrame(tick);
  else {
    running = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function schedule(first: boolean): void {
  // 一開始很快掉第一陣（讓人知道它不乖了），之後每一到三分鐘一陣。
  const wait = first ? (fast ? 300 : 4000) : fast ? 1500 : 60000 + Math.random() * 120000;
  setTimeout(() => {
    burst();
    schedule(false);
  }, wait);
}
schedule(true);
