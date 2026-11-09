import { readFileSync } from 'node:fs';
// Keep the alias so Vite does not rewrite filesystem URLs as JSDOM assets.
import { URL as NodeURL } from 'node:url';
import { afterEach, beforeEach, expect } from 'vitest';
import { diagnostics, initializeConformance } from '../backend/conformance';

const binary = new Uint8Array(
  readFileSync(
    new NodeURL(
      '../../../lexical-conformance/pkg/web/lexical_conformance_wasm_bg.wasm',
      import.meta.url
    )
  )
);
const pin: { version: string } = JSON.parse(
  readFileSync(
    new NodeURL('../../../lexical-conformance/upstream.lock', import.meta.url),
    'utf8'
  )
);
initializeConformance(new WebAssembly.Module(binary), pin.version);
beforeEach(() => diagnostics.resetKeys());
afterEach(() => expect(diagnostics.liveEditors()).toBe(0));
