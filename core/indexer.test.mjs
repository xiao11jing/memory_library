import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { rebuildIndexes } from './indexer.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'memindex-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

function makeLib() {
  const lib = mkdtempSync(join(tmp, 'lib-'));
  for (const d of ['inbox', 'archive/notes', 'index/topics', 'journal']) mkdirSync(join(lib, d), { recursive: true });
  return lib;
}

const lib = makeLib();
writeFileSync(join(lib, 'index', '总索引.md'), '---\ntype: master-index\nupdated: 2026-01-01\n---\n\n# 总索引\n\n## 用户画像\n\n这是画像，必须保留。\n\n## 主题地图\n\n- [Alpha](topics/Alpha.md)（1 条）：旧描述\n\n## 最近动态\n\n- 2026-01-01：旧动态。\n\n## 使用说明\n\n- 略\n');
writeFileSync(join(lib, 'index', 'topics', 'Alpha.md'), '---\ntype: topic-index\ntopic: "Alpha"\nupdated: 2026-01-01\n---\n\n# Alpha\n\n> 这是导语。共 1 条。\n\n## 内容列表（新到旧）\n\n- 旧条目\n');
writeFileSync(join(lib, 'archive', 'notes', 'a1.md'), '---\ntitle: "A1"\ntopic: "Alpha"\ntags: ["甲"]\nsummary: "摘要A1"\ncreated: 2026-10-01\n---\n正文A1');
writeFileSync(join(lib, 'archive', 'notes', 'a2.md'), '---\ntitle: "A2"\ntopic: "Alpha"\ntags: ["乙"]\nsummary: "摘要A2"\ncreated: 2026-11-01\n---\n正文A2');
writeFileSync(join(lib, 'archive', 'notes', 'b1.md'), '---\ntitle: "B1"\ntopic: "Beta"\ntags: ["丙"]\nsummary: "摘要B1"\ncreated: 2026-09-01\n---\n正文B1');

test('重建：主题索引生成、导语保留、条数更新、链接有效、新到旧排序', () => {
  const stats = rebuildIndexes(lib, { now: new Date('2026-11-13T12:00:00') });
  assert.equal(stats.topics, 2);
  assert.equal(stats.entries, 3);
  const alpha = readFileSync(join(lib, 'index', 'topics', 'Alpha.md'), 'utf8');
  assert.match(alpha, /共 2 条/);
  assert.match(alpha, /这是导语/);
  assert.ok(alpha.indexOf('A2') < alpha.indexOf('A1'));
  for (const m of alpha.matchAll(/\]\((\.\.\/\.\.\/[^)]+)\)/g)) {
    assert.ok(existsSync(resolve(join(lib, 'index', 'topics'), m[1])), `链接失效: ${m[1]}`);
  }
  assert.ok(existsSync(join(lib, 'index', 'topics', 'Beta.md')));
});

test('总索引：画像保留、描述保留、动态追加、日期更新', () => {
  rebuildIndexes(lib, { now: new Date('2026-11-13T12:00:00'), activity: '测试整理' });
  const master = readFileSync(join(lib, 'index', '总索引.md'), 'utf8');
  assert.match(master, /这是画像，必须保留/);
  assert.match(master, /旧描述/);
  assert.match(master, /（2 条）/);
  assert.match(master, /测试整理/);
  assert.match(master, /旧动态/);
  assert.match(master, /updated: 2026-11-13/);
});

test('总索引缺失时自动创建骨架', () => {
  const lib2 = makeLib();
  writeFileSync(join(lib2, 'archive', 'notes', 'x.md'), '---\ntitle: "X"\ntopic: "Gamma"\ncreated: 2026-11-01\n---\n正文');
  rebuildIndexes(lib2, { now: new Date('2026-11-13T12:00:00') });
  const master = readFileSync(join(lib2, 'index', '总索引.md'), 'utf8');
  assert.match(master, /type: master-index/);
  assert.match(master, /\[Gamma\]\(topics\/Gamma\.md\)（1 条）/);
});