/**
 * Typed surface of the `password_import_wasm` package, loaded on first use in
 * the import worker. `just build-password-import-wasm` builds it into the
 * gitignored `./wasm/`. The shapes are `crates/password_import_wasm/src/wire.rs`.
 */
import type { DetectOutcome, ImportFormat, ParseOutcome } from './types';

export interface PasswordImportWasmModule {
  default: (input?: { module_or_path?: unknown }) => Promise<unknown>;
  detect: (bytes: Uint8Array) => DetectOutcome;
  /** Throws only for an unknown `format` or a result it can't build. */
  parse: (bytes: Uint8Array, format: ImportFormat) => ParseOutcome;
}

let modulePromise: Promise<PasswordImportWasmModule> | undefined;

/** Loads and initializes the wasm module once per worker; a failed load is tried again. */
export function loadPasswordImportWasm(): Promise<PasswordImportWasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      try {
        const url = new URL('./wasm/password_import_wasm.js', import.meta.url)
          .href;
        const wasm = (await import(
          /* @vite-ignore */ url
        )) as PasswordImportWasmModule;
        // The generated JS's own relative wasm URL 404s in production; a static
        // `new URL` makes vite emit and rewrite the binary.
        const wasmUrl = new URL(
          './wasm/password_import_wasm_bg.wasm',
          import.meta.url
        );
        await wasm.default({ module_or_path: wasmUrl });
        return wasm;
      } catch (error) {
        modulePromise = undefined;
        throw error;
      }
    })();
  }
  return modulePromise;
}
