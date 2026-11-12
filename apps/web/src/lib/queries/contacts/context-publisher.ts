import {
  MAX_PEOPLE_BATCH,
  type PeopleScope,
} from '@graphql-cache/people/generated';
import type { PeopleCache } from '@graphql-cache/people/host';
import { PEOPLE_UNSUPPORTED } from '@graphql-cache/people/protocol';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  EMPTY_PERSON_FACTS,
  equalPersonFacts,
  type PersonFactPatch,
  type PersonFacts,
} from './context-facts';

export class ContactContextCanceled extends Error {
  constructor() {
    super('Contact context publication canceled');
  }
}
export type ContactContextPublishState =
  | 'waiting'
  | 'publishing'
  | 'ready'
  | 'unsupported';

/** One serial publisher. At most 500 dirty IDs and one 500-row write; overflow
 * replaces the snapshot instead of retaining an unbounded update history.
 * Source snapshots contain existing channel/inbox facts, never directory rows. */
export class ContactContextPublisher {
  private source: ReadonlyMap<string, PersonFacts> | undefined;
  private readonly dirty = new Map<string, number>();
  private sequence = 0;
  private continuity = 0;
  private full = true;
  private epoch: string | undefined;
  private stopped = false;
  private unsupported = false;
  private running: Promise<ContactContextPublishState> | undefined;

  constructor(
    private readonly cache: Pick<PeopleCache, 'context' | 'update'>,
    private readonly scope: PeopleScope,
    private readonly current: () => boolean
  ) {}

  get pendingCount(): number {
    return this.dirty.size;
  }

  replace(source: ReadonlyMap<string, PersonFacts> | undefined): void {
    if (this.stopped || this.unsupported || source === this.source) return;
    const previous = this.source;
    this.source = source;
    if (!source || !previous) {
      this.continuity++;
      this.full = true;
      this.dirty.clear();
      return;
    }
    if (this.full) return;
    const mark = (id: string) => {
      if (this.full) return;
      if (!this.dirty.has(id) && this.dirty.size === MAX_PEOPLE_BATCH) {
        this.full = true;
        this.dirty.clear();
      } else this.dirty.set(id, ++this.sequence);
    };
    for (const [id, facts] of source)
      if (!equalPersonFacts(facts, previous.get(id))) mark(id);
    for (const id of previous.keys()) if (!source.has(id)) mark(id);
  }

  dispose(): void {
    this.stopped = true;
    this.source = undefined;
    this.dirty.clear();
  }

  flush(): Promise<ContactContextPublishState> {
    if (this.running) return this.running;
    if (this.unsupported) return Promise.resolve('unsupported');
    if (this.stopped || !this.source) return Promise.resolve('waiting');
    this.running = this.publish();
    return this.running;
  }

  private assertActive(continuity: number): void {
    if (
      this.stopped ||
      !this.source ||
      continuity !== this.continuity ||
      !this.current()
    )
      throw new ContactContextCanceled();
  }

  private async write(
    action: Parameters<PeopleCache['update']>[0]['action'],
    epoch: string,
    continuity: number,
    span: Span
  ): Promise<void> {
    this.assertActive(continuity);
    await span.run(() =>
      this.cache.update({ scope: this.scope, epoch, action })
    );
    this.assertActive(continuity);
  }

  private async patchDirty(
    epoch: string,
    continuity: number,
    span: Span
  ): Promise<void> {
    while (!this.full && this.dirty.size) {
      this.assertActive(continuity);
      const batch = [...this.dirty]; // capped before admission, not after copying
      const updates = batch.map(([userId]) => ({
        userId,
        facts: this.source?.get(userId) ?? EMPTY_PERSON_FACTS,
      }));
      await this.write({ kind: 'patch', updates }, epoch, continuity, span);
      // A later change to this same ID survives the earlier write's ack.
      for (const [id, sequence] of batch)
        if (this.dirty.get(id) === sequence) this.dirty.delete(id);
    }
  }

  private async snapshot(continuity: number, span: Span): Promise<void> {
    this.assertActive(continuity);
    const source = this.source;
    if (!source) return;
    this.full = false;
    this.dirty.clear(); // this snapshot covers all currently queued source values
    const state = await span.run(() => this.cache.context(this.scope));
    this.assertActive(continuity);
    if (state.kind === 'unsupported') {
      this.unsupported = true;
      this.source = undefined;
      return;
    }
    const epoch = crypto.randomUUID();
    span.setAttr('contacts.context_epoch', epoch);
    span.setAttr('contacts.context_rows', source.size);
    await this.write(
      {
        kind: 'begin',
        previousEpoch: state.kind === 'missing' ? null : state.epoch,
      },
      epoch,
      continuity,
      span
    );
    let updates: PersonFactPatch[] = [];
    for (const [userId, facts] of source) {
      if (this.full) return; // overflow supersedes the incomplete snapshot
      updates.push({ userId, facts });
      if (updates.length === MAX_PEOPLE_BATCH) {
        await this.write({ kind: 'patch', updates }, epoch, continuity, span);
        updates = [];
      }
    }
    if (updates.length)
      await this.write({ kind: 'patch', updates }, epoch, continuity, span);
    await this.patchDirty(epoch, continuity, span);
    if (this.full) return;
    await this.write({ kind: 'commit' }, epoch, continuity, span);
    this.epoch = epoch;
  }

  private async publish(): Promise<ContactContextPublishState> {
    const continuity = this.continuity;
    try {
      return await Telemetry.span('contacts.context.publish', async (span) => {
        span.setAttr('cache.storage_generation', this.scope.storageGeneration);
        try {
          do {
            this.assertActive(continuity);
            if (this.full || !this.epoch) await this.snapshot(continuity, span);
            else await this.patchDirty(this.epoch, continuity, span);
            if (this.unsupported) return 'unsupported';
          } while (this.full || this.dirty.size);
          return 'ready';
        } catch (error) {
          if (!(error instanceof ContactContextCanceled))
            span.error('Contact context publication failed');
          throw error;
        }
      });
    } catch (error) {
      // A rejected call may already have committed. Never replay its epoch:
      // the next attempt reads publication state and begins a new snapshot.
      this.full = true;
      this.epoch = undefined;
      if (error instanceof Error && error.message === PEOPLE_UNSUPPORTED) {
        this.unsupported = true;
        this.source = undefined;
        this.dirty.clear();
        return 'unsupported';
      }
      throw error;
    } finally {
      this.running = undefined;
    }
  }
}
