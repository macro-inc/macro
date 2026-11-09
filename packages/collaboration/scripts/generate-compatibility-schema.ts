import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const inputs = [
  'compatibility.bop',
  'foreign-host.bop',
  'foreign-native-fields.bop',
  'compatibility-prototypes.bop',
];
const outputs = [
  'crates/client/document_session_wasm/src/compatibility_generated.rs',
  'packages/collaboration/src/session/compatibility.generated.ts',
];
const hash = createHash('sha256');
const sources = inputs.map((file) => {
  const source = readFileSync(
    resolve(root, 'crates/client/document_session_wasm/abi', file),
    'utf8'
  );
  hash.update(file).update(source);
  return source;
});
const fingerprint = hash.digest('hex');
const temporary = mkdtempSync(join(tmpdir(), 'lexical-compatibility-schema-'));
try {
  // bebopc expands include globs in filesystem order. One ordered source makes
  // declaration order and embedded schema bytes reproducible across worktrees.
  const schema = join(temporary, 'compatibility.bop');
  const config = join(temporary, 'bebop.json');
  const generated = [
    join(temporary, 'compatibility.rs'),
    join(temporary, 'compatibility.ts'),
  ];
  writeFileSync(schema, sources.join('\n'));
  writeFileSync(
    config,
    JSON.stringify({
      include: [schema],
      generators: {
        rust: { outFile: generated[0] },
        ts: { outFile: generated[1] },
      },
    })
  );
  execFileSync('bunx', ['bebopc', '-df', 'JSON', '-c', config, 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, COLUMNS: '120', LINES: '40' },
  });
  const result = [
    `${readFileSync(generated[0], 'utf8')}\n/// Exact source schema fingerprint for the paired compatibility adapter.\npub const COMPATIBILITY_SCHEMA_HASH: &str = "${fingerprint}";\n`,
    `${readFileSync(generated[1], 'utf8')}\nexport const COMPATIBILITY_SCHEMA_HASH = '${fingerprint}';\n`,
  ];
  for (const [index, file] of outputs.entries()) {
    const path = resolve(root, file);
    if (process.argv.includes('--check')) {
      if (!existsSync(path) || readFileSync(path, 'utf8') !== result[index]) {
        throw new Error(`Stale compatibility ABI: ${file}`);
      }
    } else {
      writeFileSync(path, result[index]);
    }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
