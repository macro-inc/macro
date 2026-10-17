import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Identifies what the local cache engine runs: the schema SDL the bundle
 * configures it with, and the engine's WASM. Tabs whose IDs differ must never
 * share an engine, because an engine only denormalizes fields of its own SDL.
 */
export function cacheEngineId(sdl: string, wasm?: Uint8Array): string {
  const hash = createHash('sha256');
  hash.update('sdl\0');
  hash.update(sdl);
  if (wasm) {
    hash.update('\0wasm\0');
    hash.update(wasm);
  }
  return hash.digest('hex').slice(0, 16);
}

/** Reads the engine inputs of the web app at `appRoot` (apps/web). */
export function readCacheEngineId(appRoot: string): string {
  const sdl = readFileSync(
    resolve(appRoot, '../../static_assets/schema.graphql'),
    'utf8'
  );
  const wasmPath = resolve(
    appRoot,
    'src/lib/graphql-cache/wasm/cache_wasm_bg.wasm'
  );
  return cacheEngineId(
    sdl,
    existsSync(wasmPath) ? readFileSync(wasmPath) : undefined
  );
}
