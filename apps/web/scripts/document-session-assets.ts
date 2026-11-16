import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const PACKAGE_FILES = [
  'document_session_wasm.js',
  'document_session_wasm_bg.wasm',
] as const;

/**
 * The loader's `new URL(…, import.meta.url)` references emit the session
 * package; nothing requests it while the flag is off. Vite only warns when a
 * referenced file is missing, which would ship flag-on users a 404, so fail
 * the build instead.
 */
export function documentSessionAssets(
  directory = new URL('../src/lib/core/document-session/wasm/', import.meta.url)
): Plugin {
  return {
    name: 'document-session-assets',
    apply: 'build',
    buildStart() {
      const missing = PACKAGE_FILES.filter(
        (name) => !existsSync(fileURLToPath(new URL(name, directory)))
      );
      if (missing.length === 0) return;
      throw new Error(
        `Document session package missing (${missing.join(', ')}); run \`just build-document-session-wasm\` in apps/web first.`
      );
    },
  };
}
