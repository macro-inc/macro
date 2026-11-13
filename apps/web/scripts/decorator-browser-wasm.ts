import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PACKAGE_DIRECTORY = new URL(
  '../src/lib/core/document-session/wasm/',
  import.meta.url
);
const ABI_DECLARATIONS = new URL(
  '../../../packages/collaboration/src/session/wasm.generated.d.ts',
  import.meta.url
);
const REQUIRED_FILES = [
  'document_session_wasm.js',
  'document_session_wasm_bg.wasm',
  'document_session_wasm.d.ts',
  'document_session_wasm_bg.wasm.d.ts',
  'package.json',
];

/** Check local outputs and consumer declarations; CI also verifies Git freshness. */
export function checkDecoratorBrowserWasm(): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const name of REQUIRED_FILES) {
    const bytes = readFileSync(new URL(name, PACKAGE_DIRECTORY));
    hashes[name] = createHash('sha256').update(bytes).digest('hex');
  }
  const declarations = readFileSync(
    new URL('document_session_wasm.d.ts', PACKAGE_DIRECTORY)
  );
  if (!declarations.equals(readFileSync(ABI_DECLARATIONS))) {
    throw new Error(
      'Canonical document session declarations differ from the generated ABI'
    );
  }
  return hashes;
}
