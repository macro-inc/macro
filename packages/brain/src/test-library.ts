// An explicit offline installation for tests of workspace checks and activation.
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

export function useTestLibrary(): void {
  let root: string;
  const previous = process.env.BRAIN_LIBRARY_ROOT;
  before(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'brain-test-library-'));
    await fs.symlink(
      fileURLToPath(new URL('../', import.meta.url)),
      join(root, '0.2.0'),
      'dir'
    );
    process.env.BRAIN_LIBRARY_ROOT = root;
  });
  after(async () => {
    if (previous === undefined) delete process.env.BRAIN_LIBRARY_ROOT;
    else process.env.BRAIN_LIBRARY_ROOT = previous;
    await fs.rm(root, { recursive: true, force: true });
  });
}
