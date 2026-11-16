// Deterministic client inputs only. The worker's clocks and entropy stay real.
import { createHash } from 'node:crypto';
import { expect, vi } from 'vitest';

const counters = new Map<string, number>();
function bytes(length: number, purpose: string) {
  const test = `${expect.getState().testPath?.split("/").at(-1)}:${expect.getState().currentTestName ?? 'setup'}:${purpose}`;
  let counter = counters.get(test) ?? 0;
  const result = Buffer.alloc(length);
  for (let offset = 0; offset < length; offset += 32) {
    const block = createHash('sha256').update(`${test}:${counter++}`).digest();
    block.copy(result, offset);
  }
  counters.set(test, counter);
  return result;
}

const nativeCrypto = globalThis.crypto;
vi.stubGlobal('crypto', new Proxy(nativeCrypto, {
  get(target, key) {
    if (key === 'randomUUID') return () => {
      const value = bytes(16, 'uuid');
      value[6] = (value[6] & 15) | 64;
      value[8] = (value[8] & 63) | 128;
      const text = value.toString('hex');
      return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
}));

vi.mock('loro-crdt', async importOriginal => {
  const actual = await importOriginal<typeof import('loro-crdt')>();
  return {
    ...actual,
    LoroDoc: class extends actual.LoroDoc {
      constructor() {
        super();
        this.setPeerId(bytes(8, 'peer').readBigUInt64LE());
      }
    },
  };
});

vi.mock('node:crypto', async importOriginal => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomBytes: (length: number) => bytes(length, 'content') };
});
