// @vitest-environment node
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exactTimestamp,
  MessageStore,
  normalizeMessage,
} from './message-store';

const stores: MessageStore[] = [];
async function open(maxBytes = 2 ** 31): Promise<MessageStore> {
  const store = await MessageStore.open(crypto.randomUUID(), maxBytes);
  stores.push(store);
  return store;
}
async function lines(
  store: MessageStore,
  conversation = 'C100'
): Promise<string[]> {
  const result: string[] = [];
  for await (const item of store.ordered(conversation)) result.push(item.line);
  return result;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.dispose();
});

describe('exact normalization and disk-backed dedupe', () => {
  it('normalizes the shared Rust events fixture, strips ignored payloads and skips nonmessages/deletions', async () => {
    const records = readFileSync(
      new URL(
        '../../../../../../crates/slack_integration/tests/fixtures/message-events.ndjson',
        import.meta.url
      ),
      'utf8'
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const store = await open();
    await store.stage('C100', records);
    const result = (await lines(store)).map((line) => JSON.parse(line));
    expect(result).toHaveLength(7);
    expect(result[0]).toMatchObject({
      ts: '1700000000.000001',
      thread_ts: '1700000000.000001',
    });
    expect(result[2]).toMatchObject({
      ts: '1700086400.000003',
      text: 'Edited next-day reply',
    });
    expect(result[3].thread_ts).toBe('1699999999.999999');
    expect(JSON.stringify(result)).not.toMatch(
      /replies|attachments|files|previous_message|unknown/
    );
  });

  it('orders exact timestamps of different widths and normalizes equivalent identities', async () => {
    const store = await open();
    await store.stage('C100', [
      { ts: '253402300799.999999' },
      { ts: '10.000001' },
      { ts: '9.999999' },
      { ts: '00010.000001', text: 'winner' },
      { ts: '10.000002' },
      { ts: '0.1' },
    ]);
    await store.stage('C200', [{ ts: '0.1', text: 'different conversation' }]);
    expect((await lines(store)).map((line) => JSON.parse(line).ts)).toEqual([
      '0.100000',
      '9.999999',
      '10.000001',
      '10.000002',
      '253402300799.999999',
    ]);
    expect(await lines(store, 'C200')).toHaveLength(1);
  });

  it('chooses latest edited.ts, then lexical normalized content, regardless of day order', async () => {
    const records = [
      { ts: '1.0', text: 'original' },
      {
        type: 'message',
        subtype: 'message_changed',
        ts: '100.0',
        message: { ts: '1.0', edited: { ts: '3.0' }, text: 'z' },
      },
      { ts: '1.0', edited: { ts: '4.0' }, text: 'a' },
      {
        ts: '1.0',
        edited: { ts: '4.0' },
        text: 'b',
        files: [{ huge: 'ignored' }],
      },
    ];
    const first = await open();
    const second = await open();
    for (const record of records) await first.stage('C100', [record]);
    await second.stage('C100', [...records].reverse());
    expect(await lines(first)).toEqual(await lines(second));
    expect(JSON.parse((await lines(first))[0]).text).toBe('b');
    const reordered = { text: 'b', edited: { ts: '4.0' }, ts: '1.0' };
    expect(normalizeMessage('C100', reordered)).toEqual(
      normalizeMessage('C100', records[3])
    );
  });

  it.each(['1', '1.0000001', '-1.0', '253402300800.0', '1e2.0', 1.1])(
    'rejects invalid timestamp %s',
    (value) => {
      expect(() => exactTimestamp(value)).toThrow();
    }
  );

  it('rejects malformed messages but ignores deletion identities', () => {
    for (const record of [
      {},
      { ts: '1.0', thread_ts: 1 },
      { subtype: 'message_changed' },
      { ts: '1.0', edited: { ts: 'bad' } },
    ])
      expect(() => normalizeMessage('C100', record)).toThrow();
    expect(
      normalizeMessage('C100', { subtype: 'message_deleted' })
    ).toBeUndefined();
    expect(() =>
      normalizeMessage('C100', { ts: '1.0', text: 'é'.repeat(524288) })
    ).toThrowError(expect.objectContaining({ code: 'record_limit' }));
    expect(
      normalizeMessage('C100', { ts: '1.0', files: ['x'.repeat(2 ** 20)] })
        ?.byteLength
    ).toBeLessThan(100);
  });

  it('pages without missing adjacent microseconds and permits slow asynchronous consumers', async () => {
    const store = await open();
    await store.stage(
      'C100',
      Array.from({ length: 300 }, (_, n) => ({
        ts: `1.${String(300 - n).padStart(6, '0')}`,
      }))
    );
    const result: string[] = [];
    for await (const message of store.ordered('C100')) {
      if (result.length % 128 === 0)
        await new Promise((resolve) => setTimeout(resolve, 5));
      result.push(JSON.parse(message.line).ts);
    }
    expect(result).toHaveLength(300);
    expect(result).toEqual([...result].sort());
    expect(new Set(result).size).toBe(300);
  });

  it('bounds total staged bytes and rolls back an oversized batch', async () => {
    const store = await open(200);
    await expect(
      store.stage('C100', [{ ts: '1.0' }, { ts: '2.0', text: 'x'.repeat(200) }])
    ).rejects.toMatchObject({ code: 'selected_limit' });
    expect(await lines(store)).toEqual([]);
  });

  it('sanitizes quota failures and cleans scratch storage', async () => {
    const store = await open();
    await store.stage('C100', [{ ts: '1.0' }]);
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(
      () => {
        throw new DOMException('private details', 'QuotaExceededError');
      }
    );
    await expect(store.stage('C100', [{ ts: '2.0' }])).rejects.toMatchObject({
      code: 'storage_quota',
    });
    await store.dispose();
  });

  it('cleans an abandoned session before reuse and isolates simultaneous sessions', async () => {
    const id = crypto.randomUUID();
    const first = await MessageStore.open(id, 10000);
    const other = await open();
    await first.stage('C100', [{ ts: '1.0' }]);
    await other.stage('C100', [{ ts: '2.0' }]);
    // versionchange closes the old connection, as a terminated worker would.
    const replacement = await MessageStore.open(id, 10000);
    expect(await lines(replacement)).toEqual([]);
    expect(await lines(other)).toHaveLength(1);
    await replacement.dispose();
    expect(
      (await indexedDB.databases()).some(
        (db) => db.name === `slack-import-scratch:${id}`
      )
    ).toBe(false);
  });

  it('rolls back and reports a synchronous quota failure inside a write callback', async () => {
    const store = await open();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('private details', 'QuotaExceededError');
    });
    await expect(store.stage('C100', [{ ts: '1.0' }])).rejects.toMatchObject({
      code: 'storage_quota',
    });
    expect(await lines(store)).toEqual([]);
  });

  it('cancels staging and cursor consumption', async () => {
    const store = await open();
    await store.stage('C100', [{ ts: '1.0' }]);
    const abort = new AbortController();
    abort.abort();
    await expect(
      store.stage('C100', [{ ts: '2.0' }], abort.signal)
    ).rejects.toMatchObject({ code: 'cancelled' });
    await expect(
      store.ordered('C100', abort.signal).next()
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
});
