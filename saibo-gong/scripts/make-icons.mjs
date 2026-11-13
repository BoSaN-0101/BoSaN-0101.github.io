// 用內建的 Chromium 把 SVG 轉成圖示 PNG（只在要重畫圖示時執行）。
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const svg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 64 64">
<rect x="2" y="2" width="60" height="60" rx="12" fill="#5a120a" stroke="#e6b450" stroke-width="3"/>
<path d="M8 34 Q22 2 36 26 Q22 18 8 34Z" fill="#e0a070" stroke="#ffd9a0" stroke-width="1.5" transform="rotate(-18 22 26)"/>
<path d="M28 50 Q42 18 56 42 Q42 34 28 50Z" fill="#e2422f" stroke="#ffb4a8" stroke-width="1.5" transform="rotate(14 42 40)"/>
</svg>`;
const b = await chromium.launch();
for (const [name, size] of [['icon', 256], ['tray', 32]]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<body style="margin:0;background:transparent">${svg(size)}</body>`);
  await p.screenshot({ path: `assets/${name}.png`, omitBackground: true });
}
await b.close();
