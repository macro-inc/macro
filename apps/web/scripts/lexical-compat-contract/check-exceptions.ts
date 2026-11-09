import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyExceptions } from './exceptions-check';

const manifest: unknown = JSON.parse(
  readFileSync(new URL('./exceptions.json', import.meta.url), 'utf8')
);
const result = verifyExceptions(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/lexical-wasm-shim'
  ),
  manifest
);
console.log(JSON.stringify(result, null, 2));
