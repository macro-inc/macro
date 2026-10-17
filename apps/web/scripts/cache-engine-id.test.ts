import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cacheEngineId, readCacheEngineId } from './cache-engine-id';

const SDL = 'type GraphqlSoupEmailThread { id: ID! }';

describe('cacheEngineId', () => {
  it('changes whenever the schema SDL changes', () => {
    const added = 'type GraphqlSoupEmailThread { id: ID! senders: [String!] }';
    expect(cacheEngineId(added)).not.toBe(cacheEngineId(SDL));
  });

  it('changes whenever the engine WASM changes', () => {
    const before = cacheEngineId(SDL, new Uint8Array([0, 97, 115, 109, 1]));
    const after = cacheEngineId(SDL, new Uint8Array([0, 97, 115, 109, 2]));
    expect(after).not.toBe(before);
    expect(before).not.toBe(cacheEngineId(SDL));
  });

  it('is stable for the same inputs', () => {
    expect(cacheEngineId(SDL)).toBe(cacheEngineId(SDL));
    expect(cacheEngineId(SDL)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('reads the schema and the built WASM from the repository layout', () => {
    const root = mkdtempSync(join(tmpdir(), 'cache-engine-id-'));
    try {
      const appRoot = join(root, 'apps/web');
      const wasmDir = join(appRoot, 'src/lib/graphql-cache/wasm');
      mkdirSync(wasmDir, { recursive: true });
      mkdirSync(join(root, 'static_assets'));
      const schema = join(root, 'static_assets/schema.graphql');

      writeFileSync(schema, SDL);
      const schemaOnly = readCacheEngineId(appRoot);
      expect(schemaOnly).toBe(cacheEngineId(SDL));

      writeFileSync(schema, `${SDL}\ntype Drift { id: ID! }`);
      expect(readCacheEngineId(appRoot)).not.toBe(schemaOnly);

      writeFileSync(schema, SDL);
      writeFileSync(join(wasmDir, 'cache_wasm_bg.wasm'), new Uint8Array([7]));
      expect(readCacheEngineId(appRoot)).toBe(
        cacheEngineId(SDL, new Uint8Array([7]))
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
