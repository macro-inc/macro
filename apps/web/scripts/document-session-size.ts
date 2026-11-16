import { brotliCompressSync, constants } from 'node:zlib';

/**
 * Advisory budget: the measured 2.1 MB module plus a small margin. Only users
 * with the native editor flag on fetch it (a streaming preload); flag-OFF
 * users never request it.
 */
export const SESSION_BROTLI_SOFT_CEILING = 2_200_000;

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
