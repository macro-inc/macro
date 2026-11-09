// Install virtual time/entropy before importing any shipping collaboration code.

import nodeCrypto from 'node:crypto';
import { format } from 'node:util';
import FakeTimers from '@sinonjs/fake-timers';

export const WALL_ORIGIN = 1_767_225_600_000;
export const clock = FakeTimers.install({
  now: WALL_ORIGIN,
  toFake: [
    'Date',
    'performance',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
  ],
});
const seed = process.argv[2];
if (seed === undefined || !/^\d+$/.test(seed) || Number(seed) > 0xffff_ffff)
  throw new Error('peer requires an explicit u32 entropy seed');
let entropy = Number(seed) || 1;
function random(): number {
  entropy ^= entropy << 13;
  entropy ^= entropy >>> 17;
  entropy ^= entropy << 5;
  return (entropy >>> 0) / 4_294_967_296;
}
Math.random = random;
// Nanoid's Node entry reads this port, rather than globalThis.crypto.
nodeCrypto.randomFillSync = <T extends NodeJS.ArrayBufferView>(
  buffer: T,
  offset = 0,
  size = buffer.byteLength - offset
): T => {
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(size) ||
    offset < 0 ||
    size < 0 ||
    offset + size > buffer.byteLength
  )
    throw new RangeError('invalid simulated random-fill bounds');
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, size);
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = Math.floor(random() * 256);
  return buffer;
};
let identity = 0;
Object.defineProperty(globalThis, 'crypto', {
  value: {
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      const bytes = new Uint8Array(
        array.buffer,
        array.byteOffset,
        array.byteLength
      );
      for (let index = 0; index < bytes.length; index++)
        bytes[index] = Math.floor(random() * 256);
      return array;
    },
    randomUUID(): `${string}-${string}-${string}-${string}-${string}` {
      return `00000000-0000-7000-8000-${(++identity).toString(16).padStart(12, '0')}`;
    },
  },
});
// Nanoid v5 imports Node webcrypto directly, independently of globalThis.crypto.
Object.defineProperty(nodeCrypto.webcrypto, 'getRandomValues', {
  value: <T extends ArrayBufferView>(array: T): T =>
    globalThis.crypto.getRandomValues(array),
});
Object.defineProperty(globalThis, 'fetch', {
  value: async () => {
    throw new Error('network is unavailable in the simulation peer');
  },
});
for (const level of ['log', 'info', 'debug', 'warn', 'error'] as const) {
  console[level] = (...args: unknown[]) => {
    process.stderr.write(`${format(...args)}\n`);
  };
}
// fake-indexeddb uses real setImmediate for transaction completions. Keep it real:
// these are event-loop barriers, not elapsed wall time or a source of sim time.
export const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

export class Activity {
  private readonly pending = new Set<Promise<unknown>>();
  observe<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    void operation.then(
      () => this.pending.delete(operation),
      () => this.pending.delete(operation)
    );
    return operation;
  }
  async drain(): Promise<void> {
    for (;;) {
      await clock.tickAsync(0);
      if (this.pending.size > 0) {
        await Promise.all([...this.pending]);
        continue;
      }
      await turn();
      await clock.tickAsync(0);
      if (this.pending.size === 0) return;
    }
  }
}
export const activity = new Activity();

export function wakeAt(): number | null {
  // Pinned fake-timers exposes timer deadlines but no non-advancing next().
  // Reading its table avoids advancing through a future network timeout.
  const table: unknown = Reflect.get(clock, 'timers');
  if (table === null || typeof table !== 'object') return null;
  let next = Infinity;
  for (const timer of Object.values(table)) {
    if (timer !== null && typeof timer === 'object') {
      const at: unknown = Reflect.get(timer, 'callAt');
      if (typeof at === 'number') next = Math.min(next, at);
    }
  }
  return Number.isFinite(next) ? next - WALL_ORIGIN : null;
}
