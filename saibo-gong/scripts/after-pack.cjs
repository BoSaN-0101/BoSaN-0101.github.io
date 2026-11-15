// electron-builder 打包後執行：設定 exe 的圖示和版本資訊。
// 自己處理而不用 electron-builder 內建的，是因為內建的那個要 32 位元的 wine，在 Linux 上不好裝。
// 在 Windows 上直接執行；在 Linux 上透過 64 位元的 wine 執行。

const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = join(context.appOutDir, `${context.packager.platformSpecificBuildOptions.executableName || context.packager.appInfo.productFilename}.exe`);
  const rcedit = join(__dirname, '..', 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
  const icon = join(__dirname, '..', 'build', 'icon.ico');
  const version = context.packager.appInfo.version;
  const args = [
    exe,
    '--set-icon', icon,
    '--set-file-version', version,
    '--set-product-version', version,
    '--set-version-string', 'ProductName', '賽博宮',
    '--set-version-string', 'FileDescription', '賽博宮',
    '--set-version-string', 'CompanyName', '賽博宮',
    '--set-version-string', 'InternalName', 'SaiboGong',
    '--set-version-string', 'OriginalFilename', 'SaiboGong.exe',
  ];
  if (process.platform === 'win32') {
    execFileSync(rcedit, args, { stdio: 'inherit' });
    return;
  }
  const wine = ['/usr/lib/wine/wine64', '/usr/bin/wine64', '/usr/bin/wine'].find((p) => existsSync(p));
  if (!wine) throw new Error('在 Linux 上打包 Windows 版需要 wine64（apt-get install wine64）');
  execFileSync(wine, [rcedit, ...args], { stdio: 'inherit', env: { ...process.env, WINEDEBUG: '-all', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
};
