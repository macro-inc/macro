import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { index, root } from './evidence';

const output = path.join(root, 'target/lexical-conformance');
mkdirSync(output, { recursive: true });
const rows = index().flatMap((row) =>
  row.file
    ? [
        `(${JSON.stringify(row.file)}, include_str!(${JSON.stringify(path.join(root, 'packages/lexical-conformance/fixtures', row.file))}))`,
      ]
    : []
);
writeFileSync(
  path.join(output, 'wasm-fixtures.rs'),
  '&[\n' + rows.join(',\n') + '\n]'
);
console.log(`Embedded ${rows.length} recorded fixtures for wasm replay`);
