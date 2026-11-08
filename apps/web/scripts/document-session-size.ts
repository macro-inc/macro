import { brotliCompressSync, constants } from 'node:zlib';

/** Advisory budget: a measured speed gain may justify a larger module. */
export const SESSION_BROTLI_SOFT_CEILING = 1_600_000;

export function inspectSessionSize(bytes: Uint8Array) {
  if (!WebAssembly.validate(bytes)) throw new Error('Invalid session wasm artifact');
  const compressed = brotliCompressSync(bytes, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  return {
    raw: bytes.length,
    brotli: compressed.length,
    brotliSoftCeiling: SESSION_BROTLI_SOFT_CEILING,
    aboveSoftCeiling: compressed.length > SESSION_BROTLI_SOFT_CEILING,
  };
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error('Pass the optimized session wasm path');
  const size = inspectSessionSize(await Bun.file(path).bytes());
  console.log(`document_session_wasm: ${JSON.stringify(size)}`);
  if (size.aboveSoftCeiling) {
    console.warn('Session wasm exceeds the soft Brotli ceiling; retain only with measured speed gains.');
  }
}
