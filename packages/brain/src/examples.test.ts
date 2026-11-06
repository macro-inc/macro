import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkWorkspace } from './supervisor.ts';
import { useTestLibrary } from './test-library.ts';

useTestLibrary();

test('the full release-manager composition passes brain check', async () => {
  const root = await mkdtemp(join(tmpdir(), 'brain-release-example-'));
  try {
    await cp(new URL('../template/', import.meta.url), root, {
      recursive: true,
    });
    await writeFile(
      join(root, 'brain.ts'),
      await readFile(
        new URL('../template/docs/examples/release-manager.ts', import.meta.url)
      )
    );
    await checkWorkspace(root);
    assert.match(
      await readFile(join(root, 'brain.ts'), 'utf8'),
      /release_review/
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
