/**
 * The `password_import_wasm` module, loaded in the import worker, with its
 * values typed: the generated declarations type them `any`. The shapes are
 * `crates/password_import_wasm/src/wire.rs`.
 */
import passwordImportWasm from 'wasm:password-import';
import type { DetectOutcome, ImportFormat, ParseOutcome } from './types';

export interface PasswordImportWasmModule {
  detect: (bytes: Uint8Array) => DetectOutcome;
  /** Throws only for an unknown `format` or a result it can't build. */
  parse: (bytes: Uint8Array, format: ImportFormat) => ParseOutcome;
}

/** Loads the module once per worker; a failed load is tried again. */
export async function loadPasswordImportWasm(): Promise<PasswordImportWasmModule> {
  // Checked against the generated declarations.
  const parser: PasswordImportWasmModule = await passwordImportWasm.load();
  return parser;
}
