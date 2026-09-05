import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import * as XLSX from '../web/node_modules/xlsx/xlsx.mjs';

const require = createRequire(new URL('../web/package.json', import.meta.url));

test('spreadsheet parser uses the pinned official security release', () => {
  assert.equal(XLSX.version, '0.20.3');
  const lock = JSON.parse(readFileSync(new URL('../web/package-lock.json', import.meta.url)));
  assert.equal(lock.packages['node_modules/xlsx'].resolved, 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz');
  assert.ok(lock.packages['node_modules/xlsx'].integrity);
});

for (const bookType of ['xlsx', 'xls', 'ods', 'csv']) {
  test(`chat spreadsheet extraction preserves Chinese and numbers: ${bookType}`, () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['模型', '用量'], ['TokenSea', 42]]), '测试');
    const bytes = XLSX.write(book, { type: 'buffer', bookType });
    const parsed = XLSX.read(bytes);
    assert.equal(XLSX.utils.sheet_to_csv(parsed.Sheets[parsed.SheetNames[0]]), '模型,用量\nTokenSea,42');
  });
}

test('minimist is patched and ignores prototype pollution arguments', () => {
  assert.equal(require('minimist/package.json').version, '1.2.8');
  require('minimist')(['--__proto__.tokenseaPolluted', 'yes', '--constructor.prototype.tokenseaPolluted', 'yes']);
  assert.equal({}.tokenseaPolluted, undefined);
});

test('favicon and touch icon URLs resolve to real public PNGs in both themes', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const icons = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]+>/g)];
  assert.equal(icons.length, 3);
  assert.ok(icons.some(([tag]) => tag.includes('prefers-color-scheme: dark')));
  for (const [tag] of icons) {
    const path = /href="([^"]+)"/.exec(tag)[1].split('?')[0];
    const png = readFileSync(new URL('../web/public' + path, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
});
