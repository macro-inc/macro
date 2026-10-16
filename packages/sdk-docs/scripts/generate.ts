import { createHash } from 'node:crypto';
import { cp, readdir, readFile, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSdkDocs } from '../src/render';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = join(root, 'packages/sdk-docs/dist/docs');
const reference = join(root, 'packages/sdk-docs/reference');

async function fingerprint(directory: string) {
  const hash = createHash('sha256');
  const files = (
    await readdir(directory, { recursive: true, withFileTypes: true })
  )
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort();
  if (!files.length)
    throw new Error('SDK reference is empty; run bun run generate.');
  for (const file of files) {
    hash.update(file).update('\0');
    hash.update(await readFile(join(directory, file))).update('\0');
  }
  return hash.digest('hex');
}

/** Compare every Markdown path and byte without modifying the checked-in reference. */
export async function verifyReference(reference: string, generated: string) {
  if ((await fingerprint(reference)) !== (await fingerprint(generated))) {
    throw new Error(
      'SDK reference is stale; run bun run generate and commit packages/sdk-docs/reference.'
    );
  }
}

if (import.meta.main) {
  await renderSdkDocs(root, output);
  if (Bun.argv.includes('--check')) {
    await verifyReference(reference, join(output, 'markdown'));
  } else if (!Bun.argv.includes('--build')) {
    await rm(reference, { recursive: true, force: true });
    await cp(join(output, 'markdown'), reference, { recursive: true });
  }
}
