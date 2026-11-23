import { describe, expect, it } from 'vitest';
import { loadNaturalTimeWasm } from './wasm-module';

describe('loadNaturalTimeWasm', () => {
  it('loads again after a failed load instead of keeping the failure', async () => {
    // The test runner serves modules over http, which the ESM loader refuses.
    const first = loadNaturalTimeWasm();
    await expect(first).rejects.toThrow();

    const second = loadNaturalTimeWasm();
    expect(second).not.toBe(first);
    await expect(second).rejects.toThrow();
  });
});
