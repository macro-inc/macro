import { expect, test } from 'vitest';
import { observePorts } from '../src/transcript/ports.js';

test('transaction capture retains every retry, byte argument, return and commit', async () => {
  const events: Record<string, unknown>[] = [];
  const native = {
    async put(_key: string, _value: unknown) {},
  };
  const state = {
    id: {toString: () => 'transaction-capture'},
    getWebSockets: () => [],
    storage: {
      sql: {},
      async transaction(callback: (storage: typeof native) => Promise<void>) {
        await callback(native);
        await callback(native);
        return null;
      },
    },
  };
  const [observed] = observePorts(state, {}, (line: string) => events.push(JSON.parse(line)));
  const bytes = new Uint8Array([0, 1, 254, 255]);
  await observed.storage.transaction(async (storage: typeof native) => {
    await storage.put('operation', bytes);
  });
  expect(events.map(event => event.port ?? event.return ?? event.in)).toEqual([
    'new', 'storage.transaction', 'storage.transaction.begin',
    'storage.transaction.put', 'storage.transaction.put',
    'storage.transaction.begin', 'storage.transaction.put',
    'storage.transaction.put', 'storage.transaction',
  ]);
  expect(events.filter(event => event.port === 'storage.transaction.put').map(event => event.args)).toEqual([
    ['operation', {bytes_b64: 'AAH+/w=='}],
    ['operation', {bytes_b64: 'AAH+/w=='}],
  ]);
  expect(events.filter(event => event.port === 'storage.transaction.begin').map(event => event.attempt)).toEqual([0, 1]);
  expect(events.slice(1).every(event => event.transaction === 0)).toBe(true);
  expect(events.at(-1)).toMatchObject({return: 'storage.transaction', value: null});
});

test('transaction capture retains inner failure and outer abort without manufacturing a commit', async () => {
  const events: Record<string, unknown>[] = [];
  const native = {
    async put(_key: string, _value: unknown) { throw new Error('injected failure'); },
  };
  const state = {
    id: {toString: () => 'transaction-capture-failure'},
    getWebSockets: () => [],
    storage: {
      sql: {},
      async transaction(callback: (storage: typeof native) => Promise<void>) { await callback(native); },
    },
  };
  const [observed] = observePorts(state, {}, (line: string) => events.push(JSON.parse(line)));
  await expect(observed.storage.transaction(async (storage: typeof native) => {
    await storage.put('operation', [0, 255]);
  })).rejects.toThrow('injected failure');
  expect(events.filter(event => event.throw).map(event => event.throw)).toEqual([
    'storage.transaction.put', 'storage.transaction',
  ]);
  expect(events.some(event => event.return === 'storage.transaction')).toBe(false);
});


test('transaction capture preserves a synchronous native throw', () => {
  const events: Record<string, unknown>[] = [];
  const state = {
    id: {toString: () => 'transaction-capture-sync-failure'}, getWebSockets: () => [],
    storage: {sql: {}, transaction() { throw new Error('synchronous failure'); }},
  };
  const [observed] = observePorts(state, {}, (line: string) => events.push(JSON.parse(line)));
  expect(() => observed.storage.transaction(() => {})).toThrow('synchronous failure');
  expect(events.at(-1)).toMatchObject({throw: 'storage.transaction', error: 'Error: synchronous failure', transaction: 0});
  expect(events.some(event => event.return === 'storage.transaction')).toBe(false);
});
