import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { test } from 'node:test';
import { readStyle } from './style.ts';

test('style reads nested guides in path order, skips the index, and reloads edits and additions', async () => {
  const root = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-style-')
  );
  try {
    await nodeFs.mkdir(`${root}/nested`);
    await nodeFs.writeFile(`${root}/z.md`, 'Last guide');
    await nodeFs.writeFile(`${root}/README.md`, 'Index only');
    await nodeFs.writeFile(`${root}/notes.txt`, 'Not a guide');
    await nodeFs.writeFile(`${root}/nested/a.md`, 'Nested guide');
    const first = await readStyle(root);
    assert.ok(first.includes('Nested guide\n\nLast guide'));
    assert.deepEqual(first.includes('Index only'), false);
    assert.deepEqual(first.includes('Not a guide'), false);
    await nodeFs.writeFile(`${root}/nested/a.md`, 'Revised guide');
    await nodeFs.writeFile(`${root}/a.md`, 'New guide');
    assert.ok(
      (await readStyle(root)).includes(
        'New guide\n\nRevised guide\n\nLast guide'
      )
    );
  } finally {
    await nodeFs.rm(root, { recursive: true });
  }
});
