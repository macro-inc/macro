// Use the service's pinned compiler, then expose the crate's `owned` feature.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

execFileSync(fileURLToPath(new URL('../../../services/sync-service/node_modules/.bin/bebopc', import.meta.url)), ['build'], {
  cwd: fileURLToPath(new URL('.', import.meta.url)),
  stdio: 'inherit',
});
const path = new URL('../src/generated.rs', import.meta.url);
const generated = readFileSync(path, 'utf8');
const feature = '#[cfg(feature = "bebop-owned-all")]';
if (!generated.includes(feature)) throw new Error('Bebop owned feature guard changed');
writeFileSync(path, generated.replace(feature, '#[cfg(feature = "owned")]'));
