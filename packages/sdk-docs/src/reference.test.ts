import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { verifyReference } from '../scripts/generate';

test('reference checks detect changed, added and removed pages without overwriting them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sdk-reference-'));
  const reference = join(directory, 'reference');
  const generated = join(directory, 'generated');
  try {
    await mkdir(reference);
    await mkdir(generated);
    await writeFile(join(reference, 'Document.md'), 'old signature');
    await writeFile(join(generated, 'Document.md'), 'new signature');
    await expect(verifyReference(reference, generated)).rejects.toThrow(
      'reference is stale'
    );
    expect(await readFile(join(reference, 'Document.md'), 'utf8')).toBe(
      'old signature'
    );

    await writeFile(join(reference, 'Document.md'), 'new signature');
    await expect(
      verifyReference(reference, generated)
    ).resolves.toBeUndefined();

    await writeFile(join(generated, 'New.md'), 'new method');
    await expect(verifyReference(reference, generated)).rejects.toThrow(
      'reference is stale'
    );
    await rm(join(generated, 'New.md'));
    await writeFile(join(reference, 'Removed.md'), 'removed method');
    await expect(verifyReference(reference, generated)).rejects.toThrow(
      'reference is stale'
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
