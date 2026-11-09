import { expect, type Page } from '@playwright/test';
import { z } from 'zod';
import type { DocumentReceipts } from './protocol';

const rowSchema = z.object({
  id: z.number(),
  owner: z.string(),
  seq: z.string().regex(/^\d+$/),
  delivered: z.boolean(),
  hash: z.string(),
});
const storageSchema = z.object({
  rows: z.array(rowSchema),
  covers: z.object({ owner: z.string(), seq: z.string() }).nullable(),
});
export type StorageObservation = z.infer<typeof storageSchema>;

/** Resolve only after the real readonly IndexedDB transaction commits. */
export async function committedStorage(
  page: Page,
  doc: string
): Promise<StorageObservation> {
  const result = await page.evaluate(async (scope) => {
    async function read(
      name: string,
      store: string,
      all: boolean
    ): Promise<unknown> {
      const databases = await indexedDB.databases();
      if (!databases.some((database) => database.name === name))
        return all ? [] : null;
      return new Promise((resolve, reject) => {
        const opening = indexedDB.open(name);
        opening.onupgradeneeded = () => {
          opening.transaction?.abort();
          reject(new Error('Unexpected storage creation'));
        };
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const tx = db.transaction(store, 'readonly');
          const request = all
            ? tx.objectStore(store).index('scopeId').getAll(scope)
            : tx.objectStore(store).get(scope);
          let value: unknown;
          request.onsuccess = () => {
            value = request.result;
          };
          tx.oncomplete = () => {
            db.close();
            resolve(value);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
    }
    const raw = await read('macro-document-wal', 'updates', true);
    if (!Array.isArray(raw)) throw new Error('WAL rows are not an array');
    const rows = [];
    for (const value of raw) {
      if (typeof value !== 'object' || value === null)
        throw new Error('Invalid WAL row');
      const update: unknown = Reflect.get(value, 'update');
      const owner: unknown = Reflect.get(value, 'owner');
      const seq: unknown = Reflect.get(value, 'seq');
      const delivered: unknown = Reflect.get(value, 'delivered');
      const id: unknown = Reflect.get(value, 'id');
      if (
        !(update instanceof Uint8Array) ||
        typeof owner !== 'string' ||
        typeof seq !== 'bigint' ||
        typeof delivered !== 'boolean' ||
        typeof id !== 'number'
      )
        throw new Error('Invalid native WAL fields');
      const hash = [
        ...new Uint8Array(
          await crypto.subtle.digest('SHA-256', Uint8Array.from(update))
        ),
      ]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      rows.push({ id, owner, seq: seq.toString(), delivered, hash });
    }
    const snapshot = await read('macro-document-snapshots', 'snapshots', false);
    let covers = null;
    if (typeof snapshot === 'object' && snapshot !== null) {
      const value: unknown = Reflect.get(snapshot, 'covers');
      if (typeof value === 'object' && value !== null) {
        const owner: unknown = Reflect.get(value, 'owner');
        const seq: unknown = Reflect.get(value, 'seq');
        if (typeof owner !== 'string' || typeof seq !== 'bigint')
          throw new Error('Invalid snapshot cover');
        covers = { owner, seq: seq.toString() };
      }
    }
    return { rows, covers };
  }, doc);
  return storageSchema.parse(result);
}

export async function waitForDurability(
  page: Page,
  doc: string,
  baseline: StorageObservation,
  receipts: DocumentReceipts,
  sentBefore: number
) {
  const observed = new Map<string, StorageObservation['rows'][number]>();
  let final: StorageObservation | undefined;
  await expect
    .poll(
      async () => {
        if (receipts.errors.length) throw new Error(receipts.errors.join('\n'));
        const current = await committedStorage(page, doc);
        final = current;
        const sent = receipts.sent
          .slice(sentBefore)
          .filter((update) => update.doc === doc);
        const hashes = new Set(sent.flatMap((update) => update.hashes));
        for (const row of current.rows) {
          if (
            hashes.has(row.hash) &&
            !baseline.rows.some(
              (old) => old.owner === row.owner && old.seq === row.seq
            )
          )
            observed.set(`${row.owner}:${row.seq}`, row);
        }
        if (
          !sent.length ||
          !observed.size ||
          sent.some(
            (update) => !receipts.acknowledged.has(`${doc}:${update.id}`)
          )
        )
          return false;
        if (current.rows.some((row) => !row.delivered)) return false;
        if (
          [...hashes].some(
            (hash) => ![...observed.values()].some((row) => row.hash === hash)
          )
        )
          return false;
        return [...observed.values()].every(
          (row) =>
            current.rows.some(
              (value) =>
                value.owner === row.owner &&
                value.seq === row.seq &&
                value.delivered
            ) ||
            (current.covers?.owner === row.owner &&
              BigInt(current.covers.seq) >= BigInt(row.seq))
        );
      },
      {
        timeout: 90_000,
        message:
          'Matching document ACK and committed WAL delivery/cover are required',
      }
    )
    .toBe(true);
  return {
    sent: receipts.sent.slice(sentBefore),
    observed: [...observed.values()],
    committed: final,
  };
}
