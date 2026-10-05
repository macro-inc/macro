import { describe, expect, it } from 'vitest';
import { loadDatabaseSqlWasm } from './wasm-module';

describe('loadDatabaseSqlWasm', () => {
  it('loads again after a failed load instead of keeping the failure', async () => {
    // The test runner serves modules over http, which the ESM loader refuses.
    const first = loadDatabaseSqlWasm();
    await expect(first).rejects.toThrow();

    const second = loadDatabaseSqlWasm();
    expect(second).not.toBe(first);
    await expect(second).rejects.toThrow();
  });
});
