// 应用图标生成：从背景原图裁以脸为中心的方形，输出多尺寸 ICO 与 256 PNG。
// 运行：npx electron scripts/make-icon.mjs（复用现有 Electron 的 nativeImage，不引新依赖）
import { app, nativeImage } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'app', 'renderer', 'assets', 'bg.png');
const outDir = join(root, 'build');
mkdirSync(outDir, { recursive: true });

const img = nativeImage.createFromPath(src);
const { width, height } = img.getSize();
if (!width || !height) { console.error('背景图读取失败：' + src); app.quit(); process.exitCode = 1; }

// 脸部中心约在 (54.5% 宽, 40% 高)，方形边长取 72% 高，避开右下角水印
const side = Math.round(height * 0.72);
const cx = Math.round(width * 0.545);
const cy = Math.round(height * 0.40);
const x = Math.max(0, Math.min(width - side, cx - Math.round(side / 2)));
const y = Math.max(0, Math.min(height - side, cy - Math.round(side / 2)));
const face = img.crop({ x, y, width: side, height: side });

const sizes = [16, 32, 48, 256];
const pngs = sizes.map((s) => face.resize({ width: s, height: s }).toPNG());

// ICO 容器：ICONDIR + ICONDIRENTRY[] + PNG 数据（Vista+ 支持 PNG 压缩条目）
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = [];
sizes.forEach((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s === 256 ? 0 : s, 0); // 256 记为 0
  e.writeUInt8(s === 256 ? 0 : s, 1);
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  entries.push(e);
});
writeFileSync(join(outDir, 'icon.ico'), Buffer.concat([header, ...entries, ...pngs]));
writeFileSync(join(outDir, 'icon.png'), face.resize({ width: 256, height: 256 }).toPNG());
console.log(JSON.stringify({ src: { width, height }, crop: { x, y, side }, ico: join(outDir, 'icon.ico') }));
app.quit();