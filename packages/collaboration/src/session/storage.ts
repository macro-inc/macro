import type { DBSchema } from 'idb';
import { RecoverableDatabase } from '../collab/recoverable-database';
import { snapshotWriteLock } from '../collab/snapshot-store';
import {
  Failure,
  type ILocalStateMsg,
  type IOwnerRowsMsg,
  type IStorageOpMsg,
  type IWalRecordMsg,
  LocalStateMsg,
} from './abi.generated';

interface WalRow {
  id?: number;
  scopeId: string;
  update: Uint8Array;
  delivered: boolean;
  createdAt: number;
  owner?: string;
  seq?: bigint;
  user?: string;
  foreign?: boolean;
  quarantined?: boolean;
}
interface WalSchema extends DBSchema {
  updates: { key: number; value: WalRow; indexes: { scopeId: string } };
}
interface SnapSchema extends DBSchema {
  snapshots: {
    key: string;
    value: {
      scopeId: string;
      snapshot: Uint8Array;
      covers?: { owner: string; seq: bigint };
    };
  };
}
export type StorageResult =
  | { kind: 'loaded'; payload?: Uint8Array; failure: Failure }
  | { kind: 'adopted'; adopted: number; failure: Failure }
  | { kind: 'done'; ok: boolean; failure: Failure };

export const ownerLock = (doc: string, owner: string) =>
  `macro-wal:${doc}:${owner}`;
function failure(error: unknown): Failure {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return Failure.QuotaExceeded;
    if (error.name === 'AbortError') return Failure.Uncertain;
    if (error.name === 'DataError' || error.name === 'DataCloneError')
      return Failure.Corrupt;
  }
  return Failure.Unavailable;
}
function record(row: WalRow, legacyUser: string): IWalRecordMsg {
  if (
    !(row.update instanceof Uint8Array) ||
    !Number.isFinite(row.createdAt) ||
    (row.owner !== undefined && (typeof row.seq !== 'bigint' || row.seq < 1n))
  )
    throw new DOMException('Invalid WAL row', 'DataError');
  return {
    seq: row.seq ?? BigInt(row.id ?? 0),
    createdAt: BigInt(row.createdAt),
    // Only unowned v1 rows predate user attribution. Never relabel a session row.
    user: row.user ?? (row.owner === undefined ? legacyUser : ''),
    foreign: row.foreign ?? false,
    quarantined: row.quarantined ?? false,
    delivered: row.delivered,
    bytes: row.update,
  };
}

/** Compatible v1 storage. Retry/retention decisions arrive from the native core. */
export class StorageAdapter {
  private readonly wal = new RecoverableDatabase<WalSchema>(
    'macro-document-wal',
    1,
    (db) => {
      const store = db.createObjectStore('updates', {
        keyPath: 'id',
        autoIncrement: true,
      });
      store.createIndex('scopeId', 'scopeId');
    }
  );
  private readonly snapshots = new RecoverableDatabase<SnapSchema>(
    'macro-document-snapshots',
    1,
    (db) => {
      db.createObjectStore('snapshots', { keyPath: 'scopeId' });
    }
  );
  private readonly keys = new Map<bigint, number>();
  private queue: Promise<void> = Promise.resolve();
  constructor(
    readonly doc: string,
    readonly owner: string,
    readonly user: string,
    private readonly locks: Pick<
      LockManager,
      'query' | 'request'
    > = navigator.locks
  ) {}

  execute(op: IStorageOpMsg): Promise<StorageResult> {
    const run = this.queue.then(async (): Promise<StorageResult> => {
      try {
        if (op.doc !== this.doc || (op.owner && op.owner !== this.owner))
          throw new DOMException('Storage scope mismatch', 'DataError');
        const guarded = () =>
          this.locks.request(snapshotWriteLock(this.doc), () => this.apply(op));
        if ((op.kind === 5 || op.kind === 6) && op.from)
          return await this.locks.request(
            ownerLock(this.doc, op.from),
            { ifAvailable: true },
            async (lock): Promise<StorageResult> =>
              lock
                ? guarded()
                : op.kind === 5
                  ? { kind: 'adopted', adopted: -1, failure: Failure.Other }
                  : { kind: 'done', ok: false, failure: Failure.Other }
          );
        if ([0, 1, 4, 5, 8, 9].includes(op.kind)) return await guarded();
        return await this.apply(op);
      } catch (error) {
        const code = failure(error);
        if (op.kind === 0 || op.kind === 1)
          return { kind: 'loaded', failure: code };
        if (op.kind === 5)
          return { kind: 'adopted', adopted: -1, failure: code };
        return { kind: 'done', ok: false, failure: code };
      }
    });
    this.queue = run.then(() => undefined);
    return run;
  }
  async drain(): Promise<void> {
    await this.queue;
  }

  private async load(snapshot: boolean): Promise<StorageResult> {
    const held = new Set(
      (await this.locks.query()).held?.map((lock) => lock.name)
    );
    const tx = await this.wal.transaction('updates', 'readonly');
    const orphans = new Map<string, IOwnerRowsMsg>();
    const assist = new Map<string, IOwnerRowsMsg>();
    let cursor = await tx.store.index('scopeId').openCursor(this.doc);
    while (cursor) {
      const row = cursor.value;
      if (row.owner === this.owner) {
        const r = record(row, this.user);
        this.keys.set(r.seq, cursor.primaryKey);
      } else {
        const live = !!row.owner && held.has(ownerLock(this.doc, row.owner));
        // Foreign-user orphan metadata reaches Rust only for TTL cleanup, never replay.
        if (live && row.user !== this.user) {
          cursor = await cursor.continue();
          continue;
        }
        const target = live ? assist : orphans;
        if (!live || !row.delivered) {
          const owner = row.owner ?? '';
          let group = target.get(owner);
          if (!group) {
            group = { owner, records: [] };
            target.set(owner, group);
          }
          group.records.push(record(row, this.user));
        }
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    for (const groups of [orphans, assist])
      for (const group of groups.values())
        group.records.sort((a, b) =>
          a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0
        );
    let state: ILocalStateMsg = {
      snapshot: new Uint8Array(),
      coversOwner: '',
      coversSeq: 0n,
      orphans: [...orphans.values()],
      assist: [...assist.values()],
    };
    if (snapshot) {
      const read = await this.snapshots.transaction('snapshots', 'readonly');
      const row = await read.store.get(this.doc);
      await read.done;
      if (row) {
        if (!(row.snapshot instanceof Uint8Array))
          throw new DOMException('Invalid snapshot', 'DataError');
        state = {
          ...state,
          snapshot: row.snapshot,
          coversOwner: row.covers?.owner ?? '',
          coversSeq: row.covers?.seq ?? 0n,
        };
      }
    }
    return {
      kind: 'loaded',
      payload: LocalStateMsg.encode(state),
      failure: Failure.None,
    };
  }
  private async append(op: IStorageOpMsg): Promise<void> {
    if (this.keys.has(op.record.seq)) return;
    for (let attempt = 0; ; attempt++) {
      const tx = await this.wal.transaction('updates', 'readwrite');
      const done = tx.done; // Observe aborts even when a request fails first.
      try {
        if (op.retry) {
          let cursor = await tx.store.index('scopeId').openCursor(this.doc);
          while (cursor) {
            if (
              cursor.value.owner === this.owner &&
              cursor.value.seq === op.record.seq
            ) {
              const id = cursor.primaryKey;
              await done;
              this.keys.set(op.record.seq, id);
              return;
            }
            cursor = await cursor.continue();
          }
        }
        const id = await tx.store.add({
          scopeId: this.doc,
          update: op.record.bytes,
          delivered: false,
          createdAt: Number(op.record.createdAt),
          owner: this.owner,
          seq: op.record.seq,
          user: op.record.user,
          foreign: op.record.foreign,
          quarantined: op.record.quarantined,
        });
        if (op.terminal) tx.commit();
        await done;
        this.keys.set(op.record.seq, id);
        return;
      } catch (error) {
        // A rejected done promise proves rollback; retry a single AbortError only.
        const rollback = await done.then(
          () => false,
          () => true
        );
        if (
          attempt === 0 &&
          rollback &&
          error instanceof DOMException &&
          error.name === 'AbortError'
        )
          continue;
        throw error;
      }
    }
  }
  private async apply(op: IStorageOpMsg): Promise<StorageResult> {
    if (op.kind === 0 || op.kind === 1) return this.load(op.kind === 0);
    if (op.kind === 2) {
      await this.append(op);
      return { kind: 'done', ok: true, failure: Failure.None };
    }
    if (op.kind === 8 || op.kind === 9) {
      const tx = await this.snapshots.transaction('snapshots', 'readwrite');
      if (op.kind === 8)
        await tx.store.put({
          scopeId: this.doc,
          snapshot: op.snapshot,
          ...(op.coversOwner
            ? { covers: { owner: op.coversOwner, seq: op.coversSeq } }
            : {}),
        });
      else await tx.store.delete(this.doc);
      await tx.done;
      return { kind: 'done', ok: true, failure: Failure.None };
    }
    let pruneCover = 0n;
    if (op.kind === 4 || op.kind === 5) {
      const snapshot = await this.snapshots.transaction(
        'snapshots',
        'readonly'
      );
      const row = await snapshot.store.get(this.doc);
      await snapshot.done;
      pruneCover = row?.covers?.owner === this.owner ? row.covers.seq : 0n;
      const covers =
        op.from && row?.covers?.owner === op.from ? row.covers.seq : 0n;
      if (op.kind === 5 && covers !== op.through)
        return { kind: 'adopted', adopted: -1, failure: Failure.Other };
    }
    const tx = await this.wal.transaction('updates', 'readwrite');
    const done = tx.done;
    const changes: [bigint, number | undefined][] = [];
    let adopted = 0;
    try {
      if (op.kind === 3 || op.kind === 7) {
        for (const [seq, id] of this.keys) {
          if (
            (op.kind === 3 && seq <= op.through) ||
            (op.kind === 7 && seq === op.seq)
          ) {
            const row = await tx.store.get(id);
            if (row?.owner === this.owner && row.seq === seq)
              await tx.store.put({
                ...row,
                ...(op.kind === 3
                  ? { delivered: true }
                  : { quarantined: true }),
              });
          }
        }
      } else if (op.kind === 4 || op.kind === 5 || op.kind === 6) {
        const rows: { row: WalRow; id: number }[] = [];
        let cursor = await tx.store.index('scopeId').openCursor(this.doc);
        while (cursor) {
          rows.push({ row: cursor.value, id: cursor.primaryKey });
          cursor = await cursor.continue();
        }
        rows.sort((a, b) => {
          const left = a.row.seq ?? BigInt(a.id),
            right = b.row.seq ?? BigInt(b.id);
          return left < right ? -1 : left > right ? 1 : 0;
        });
        if (op.kind === 5) {
          const selected = rows.filter(
            ({ row, id }) =>
              (row.owner ?? '') === op.from &&
              (!row.delivered || (row.seq ?? BigInt(id)) > op.through)
          );
          const same =
            selected.length === op.expected.length &&
            selected.every(({ row }, index) => {
              const actual = record(row, this.user);
              const expected = op.expected[index];
              return (
                expected !== undefined &&
                actual.seq === expected.seq &&
                actual.createdAt === expected.createdAt &&
                actual.user === expected.user &&
                actual.foreign === expected.foreign &&
                actual.quarantined === expected.quarantined &&
                actual.delivered === expected.delivered &&
                actual.bytes.length === expected.bytes.length &&
                actual.bytes.every((byte, i) => byte === expected.bytes[i])
              );
            });
          const occupied = selected.some((_, offset) => {
            const seq = op.seq + BigInt(offset);
            return (
              seq > 0xffff_ffff_ffff_ffffn ||
              rows.some(
                ({ row }) => row.owner === this.owner && row.seq === seq
              )
            );
          });
          if ((selected.length > 0 && !same) || occupied) {
            tx.abort();
            await done.catch(() => undefined);
            return { kind: 'adopted', adopted: -1, failure: Failure.Other };
          }
        }
        for (const { row, id } of rows) {
          if (
            op.kind === 4 &&
            row.owner === this.owner &&
            row.seq !== undefined &&
            row.seq <= op.through &&
            row.seq <= pruneCover &&
            row.delivered
          ) {
            await tx.store.delete(id);
            changes.push([row.seq, undefined]);
          }
          if (
            op.kind === 6 &&
            (row.owner ?? '') === op.from &&
            !row.delivered &&
            row.createdAt < Number(op.before)
          )
            await tx.store.delete(id);
          if (op.kind === 5 && (row.owner ?? '') === op.from) {
            if (record(row, this.user).user !== this.user)
              throw new DOMException('Foreign user adoption', 'DataError');
            if (row.delivered && (row.seq ?? BigInt(id)) <= op.through)
              await tx.store.delete(id);
            else {
              const seq = op.seq + BigInt(adopted++);
              await tx.store.put({
                ...row,
                owner: this.owner,
                seq,
                user: row.user ?? this.user,
              });
              changes.push([seq, id]);
            }
          }
        }
      } else throw new DOMException('Unknown storage operation', 'DataError');
      await done;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => undefined);
      throw error;
    }
    for (const [seq, id] of changes) {
      if (id === undefined) this.keys.delete(seq);
      else this.keys.set(seq, id);
    }
    return op.kind === 5
      ? { kind: 'adopted', adopted, failure: Failure.None }
      : { kind: 'done', ok: true, failure: Failure.None };
  }
}
