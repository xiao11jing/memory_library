// Windows 安装包构建（本机特化）：
// 本机工作区监控会锁住工作区内新建的 .asar 文件，electron-builder 的解包/改名步骤在
// 工作区内必失败（EBUSY/EPERM）。故在 workspace 外的临时目录构建（node_modules 用
// junction 共享，零拷贝），完成后把安装包拷回 release/。
// 用法：node scripts/build-win.mjs   （等价于 npm run dist）
import { cpSync, mkdtempSync, rmSync, symlinkSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const build = mkdtempSync(join(tmpdir(), 'memlib-build-'));
console.log('临时构建目录：' + build);

for (const item of ['app', 'core', 'scripts', 'build', 'package.json', 'package-lock.json']) {
  cpSync(join(root, item), join(build, item), { recursive: true });
}
symlinkSync(join(root, 'node_modules'), join(build, 'node_modules'), 'junction');

const r = spawnSync(process.execPath, [join(build, 'node_modules', 'electron-builder', 'cli.js'), '--win'], {
  cwd: build, stdio: 'inherit', timeout: 600000,
});
if (r.status !== 0) {
  console.error('构建失败，临时目录保留供排查：' + build);
  process.exit(1);
}

mkdirSync(join(root, 'release'), { recursive: true });
for (const f of readdirSync(join(build, 'release'))) {
  if (f.endsWith('.exe') || f.endsWith('.blockmap')) {
    copyFileSync(join(build, 'release', f), join(root, 'release', f));
    console.log('拷回 release/' + f);
  }
}
// 先摘 junction（只删链接不碰目标），再清临时目录
rmSync(join(build, 'node_modules'), { force: true });
rmSync(build, { recursive: true, force: true });
console.log('完成：安装包在 release/');