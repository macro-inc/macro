import { resolve } from 'node:path';
import { documentCapsuleInputs } from './fixtures/filter-corpus';

const web = resolve(import.meta.dirname, '../..');
const child = Bun.spawn(
  [
    'cargo',
    'run',
    '--quiet',
    '-p',
    'soup-filter-cache-adapter',
    '--example',
    'filter_fixture_capsules',
  ],
  {
    cwd: resolve(web, '../..'),
    env: {
      ...process.env,
      CARGO_TARGET_DIR:
        process.env.CARGO_TARGET_DIR ?? resolve(web, 'tauri/target/e2e/cargo'),
    },
    stdin: new Blob([JSON.stringify(documentCapsuleInputs())]),
    stdout: 'pipe',
    stderr: 'inherit',
  }
);
const capsules = await new Response(child.stdout).text();
if (await child.exited)
  throw new Error('Canonical Rust fixture encoding failed');
JSON.parse(capsules);
const path = resolve(import.meta.dirname, 'fixtures/filter-capsules.json');
await Bun.write(path, capsules);
console.log(`Generated ${path}`);
