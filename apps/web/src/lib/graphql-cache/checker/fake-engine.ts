/**
 * Stands in for the WASM engine (`CacheWorkerCore` over turso-opfs) inside the
 * real engine runtime. It keeps the parts of the engine the handover depends
 * on, and nothing else: it takes the database owner lock without queueing,
 * reports a busy lock, waits for the coordinator's storage grant, wipes the
 * database on a recovery open (as `recovery_wipe` does, mutation queue
 * included), refuses requests once draining with the same untyped message,
 * and waits for an in-flight open before a drain closes storage.
 *
 * `DurableStorage` is the origin's OPFS: one database per scope that outlives
 * every page and worker.
 */

import { fireAndForget } from '@core/util/fireAndForget';
import { match } from 'ts-pattern';
import { TEST_AUTHORITY_GENERATION, testAuthority } from '../authority-fixture';
import type { CacheRequest, CacheResponse } from '../protocol';
import { databaseOwnerLockName } from '../worker/coordinator-protocol';
import type { CacheWorkerCoreOptions } from '../worker/worker-core';
import type { Sim, SimContext } from './sim';

export const DRAFT_MUTATION =
  'mutation SaveDraft($input: SaveEmailDraftInput!) { saveEmailDraft(input: $input) { draftId } }';

export type StoredMutation = { uuid: string; enqueuedBy: string };

type Database = {
  queue: Map<string, StoredMutation>;
  wipes: number;
  openBy: string | undefined;
};

export class DurableStorage {
  readonly databases = new Map<string, Database>();
  /** Violations of one-open-handle found while the run was going. */
  readonly openConflicts: string[] = [];
  /** Every mutation that reached a durable queue, with where it went. */
  readonly admitted = new Map<string, string>();
  /** How many of the next opens fail with a storage error. */
  failNextOpens = 0;
  /** Each open, in order: which build opened which database. */
  readonly opens: { engine: string; buildTime: number; scope: string }[] = [];

  database(scope: string): Database {
    let database = this.databases.get(scope);
    if (!database) {
      database = { queue: new Map(), wipes: 0, openBy: undefined };
      this.databases.set(scope, database);
    }
    return database;
  }

  open(scope: string, engine: string, buildTime: number): void {
    const database = this.database(scope);
    this.opens.push({ engine, buildTime, scope });
    if (database.openBy !== undefined && database.openBy !== engine)
      this.openConflicts.push(
        `${engine} opened ${scope} while ${database.openBy} had it open`
      );
    database.openBy = engine;
  }

  wipe(scope: string): void {
    const database = this.database(scope);
    database.queue.clear();
    database.wipes += 1;
  }

  close(scope: string, engine: string): void {
    const database = this.database(scope);
    if (database.openBy === engine) database.openBy = undefined;
  }
}

type Port = { postMessage(message: unknown): void };

export class FakeEngineCore {
  private accepting = true;
  private opening: Promise<void> | undefined;
  private openedScope: string | undefined;
  private releaseLock: (() => void) | undefined;
  private active = 0;
  private readonly idle = new Set<() => void>();

  constructor(
    private readonly sim: Sim,
    private readonly storage: DurableStorage,
    private readonly context: SimContext,
    private readonly options: CacheWorkerCoreOptions
  ) {}

  addPort(): void {}

  async handleRequest(port: Port, request: CacheRequest): Promise<void> {
    const respond = (response: CacheResponse) => port.postMessage(response);
    if (!this.accepting) {
      respond({ id: request.id, ok: false, error: 'cache engine is draining' });
      return;
    }
    this.active += 1;
    try {
      if (request.kind !== 'init') await this.laterTask();
      const result = await this.answer(request);
      respond({
        id: request.id,
        ok: true,
        result,
        authorityGeneration: TEST_AUTHORITY_GENERATION,
      });
    } catch (error) {
      respond({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.active -= 1;
      if (this.active === 0) {
        for (const wake of [...this.idle]) wake();
        this.idle.clear();
      }
    }
  }

  /** The core queues a request and starts it in a later task. */
  private async laterTask(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.sim.queueTask(
        this.context,
        `engine:${this.context.id}`,
        'engine-task',
        resolve
      );
    });
  }

  /** The scope whose database this engine has open. */
  get serving(): string | undefined {
    return this.context.alive && this.accepting ? this.openedScope : undefined;
  }

  private async answer(request: CacheRequest): Promise<unknown> {
    return await match(request)
      .with({ kind: 'init' }, async ({ id, scope }) => {
        if (id === 0) {
          this.opening = this.open(scope);
          await this.opening;
        }
        return null;
      })
      .with({ kind: 'current-revision' }, () => '1')
      .with(
        { kind: 'current-storage-generation' },
        () => TEST_AUTHORITY_GENERATION
      )
      .with({ kind: 'current-authority' }, ({ identity }) =>
        testAuthority(identity)
      )
      .with({ kind: 'transition-authority' }, ({ identity }) => ({
        authority: testAuthority(identity),
        revision: '1',
        changed: false,
        affectedOps: [],
      }))
      .with({ kind: 'read' }, () => ({
        kind: 'hit',
        data: { servedBy: this.context.id },
      }))
      .with({ kind: 'inspect-mutations' }, () =>
        [...this.database().queue.values()].map((mutation) => ({
          transactionId: mutation.uuid,
          uuid: mutation.uuid,
          superseded: false,
          query: DRAFT_MUTATION,
          variables: { input: { draftId: mutation.uuid } },
          optimisticData: null,
          enqueuedAtMs: 0,
        }))
      )
      .with({ kind: 'enqueue-optimistic-mutation' }, ({ uuid }) => {
        this.storage.admitted.set(uuid, this.openedScope ?? '');
        this.database().queue.set(uuid, {
          uuid,
          enqueuedBy: this.context.id,
        });
        return {
          transactionId: uuid,
          changed: [],
          affectedOps: [],
          reset: false,
          upsertKind: { kind: 'inserted' },
          initialClaim: { kind: 'not-runnable' },
        };
      })
      // The requests the handover does not depend on.
      .otherwise(() => null);
  }

  private database() {
    if (this.openedScope === undefined)
      throw new Error('cache engine is not initialized');
    return this.storage.database(this.openedScope);
  }

  private async open(scope: string): Promise<void> {
    const lockName = databaseOwnerLockName(scope);
    for (let attempt = 1; ; attempt += 1) {
      if (await this.takeOwnerLock(lockName)) break;
      await this.options.onOwnerLockBusy?.(attempt);
    }
    await this.options.onOwnerLockAcquired?.();
    if (this.options.recoveryOpen) this.storage.wipe(scope);
    if (this.storage.failNextOpens > 0) {
      this.storage.failNextOpens -= 1;
      this.releaseLock?.();
      throw new Error('storage error: unable to open database file');
    }
    this.storage.open(scope, this.context.id, this.context.buildTime);
    this.openedScope = scope;
    this.options.onInitializationOutcome?.(
      this.options.recoveryOpen ? 'reset-storage-uncertain' : 'opened-existing'
    );
  }

  /** Like turso-opfs: never queue for the lock, and hold it until closed. */
  private async takeOwnerLock(lockName: string): Promise<boolean> {
    return await new Promise<boolean>((granted) => {
      const held = this.sim.locks.request(
        lockName,
        { mode: 'exclusive', ifAvailable: true },
        (lock) => {
          granted(lock !== null);
          if (!lock) return;
          return new Promise<void>((release) => {
            this.releaseLock = release;
          });
        }
      );
      fireAndForget(held, 'handover-checker');
    });
  }

  async drain(): Promise<void> {
    this.accepting = false;
    if (this.active > 0)
      await new Promise<void>((resolve) => this.idle.add(resolve));
    await this.openSettled();
    if (this.openedScope !== undefined)
      this.storage.close(this.openedScope, this.context.id);
    this.releaseLock?.();
    this.releaseLock = undefined;
  }

  private async openSettled(): Promise<void> {
    try {
      await this.opening;
    } catch {
      // The failed open was reported to whoever asked for it.
    }
  }

  /** The worker was terminated: the browser closes its files and lock. */
  terminated(): void {
    if (this.openedScope !== undefined)
      this.storage.close(this.openedScope, this.context.id);
  }
}
