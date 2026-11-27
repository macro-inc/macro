import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { app, checkFile, checkUrl } from './boundary';

test('the Vite boundary permits Bots and SDK source and rejects other workspace files', () => {
  expect(() => checkFile(resolve(app, 'src/main.tsx'))).not.toThrow();
  expect(() =>
    checkFile(resolve(app, '../../packages/sdk/package.json'))
  ).not.toThrow();
  for (const path of [
    '../web/package.json',
    '../marketing/package.json',
    '../../packages/entity-icons/package.json',
  ]) {
    expect(() => checkFile(resolve(app, path))).toThrow('Bots cannot load');
  }
});

test.each([
  '/app/icon.svg',
  '/live-editor/style.css',
  '/@fs/etc/passwd',
  '//example.com/script.js',
])('rejects legacy and external assets at %s', (url) => {
  expect(() => checkUrl(url)).toThrow('Bots cannot load URL');
});
