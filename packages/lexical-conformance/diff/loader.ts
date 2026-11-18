import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { CoreHandle } from '../pkg/node/lexical_conformance_wasm';

const require = createRequire(import.meta.url);
const wasm = require('../pkg/node/lexical_conformance_wasm.js') as {
  CoreHandle: typeof CoreHandle;
  upstream_version(): string;
};
const pin = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../upstream.lock'), 'utf8')
) as { version: string };
if (wasm.upstream_version() !== pin.version)
  throw new Error('Conformance WASM version mismatch');
export const RustCore = wasm.CoreHandle;
