import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const common = { bundle: true, sourcemap: true, logLevel: 'info' };
// tesseract.js 會自己啟動另一個執行緒載入它的檔案，不能打包進來。
await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js', platform: 'node', format: 'cjs', external: ['electron', 'tesseract.js'] });
await build({ ...common, entryPoints: ['src/main/hook-client.ts'], outfile: 'dist/hook-client.js', platform: 'node', format: 'cjs' });
await build({ ...common, entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.js', platform: 'node', format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: ['src/renderer/renderer.ts'], outfile: 'dist/renderer/renderer.js', platform: 'browser', format: 'iife' });
await build({ ...common, entryPoints: ['src/renderer/crumbs.ts'], outfile: 'dist/renderer/crumbs.js', platform: 'browser', format: 'iife' });
mkdirSync('dist/renderer', { recursive: true });
cpSync('src/renderer/crumbs.html', 'dist/renderer/crumbs.html');
cpSync('src/renderer/index.html', 'dist/renderer/index.html');
cpSync('src/renderer/style.css', 'dist/renderer/style.css');
cpSync('assets', 'dist/assets', { recursive: true });
