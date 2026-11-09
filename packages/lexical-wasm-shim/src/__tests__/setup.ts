import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect } from 'vitest';
import { diagnostics, initializeConformance } from '../backend/conformance';

const binary = new Uint8Array(
  readFileSync(
    new URL(
      '../../../lexical-conformance/pkg/web/lexical_conformance_wasm_bg.wasm',
      import.meta.url
    )
  )
);
const pin: { version: string } = JSON.parse(
  readFileSync(
    new URL('../../../lexical-conformance/upstream.lock', import.meta.url),
    'utf8'
  )
);
initializeConformance(new WebAssembly.Module(binary), pin.version);
beforeEach(() => diagnostics.resetKeys());
afterEach(() => expect(diagnostics.liveEditors()).toBe(0));
