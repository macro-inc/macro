import type {
  IForeignKey,
  IForeignRecordRef,
  IForeignRenderRecord,
} from '@macro-inc/collaboration/session/compatibility.generated';
import { publicKey } from './values';

interface Stamp {
  readonly version: bigint;
  readonly order: number;
}
interface Revision {
  readonly version: bigint;
  readonly record: IForeignRecordRef | null;
  readonly inserted: Stamp;
}
interface Snapshot {
  readonly version: bigint;
  readonly order: ReadonlyMap<string, number>;
}
interface VersionState {
  count: number | undefined;
  snapshot: Snapshot | undefined;
  nextOrder: number;
}

interface Head {
  readonly version: bigint;
  readonly state: VersionState;
}
interface Membership {
  readonly version: bigint;
  readonly state: VersionState;
  readonly present: boolean;
}

/** An index of acknowledged native records, never another editable graph. */
export class RecordMirror {
  private readonly histories = new Map<string, Revision[]>();
  private readonly versions = new Set<bigint>();
  private readonly states = new Map<bigint, VersionState>();
  private readonly changed = new Map<bigint, Set<string>>();
  private readonly waiting = new Map<bigint, Set<string>>();
  private readonly undo = new Map<bigint, Map<string, Revision>>();
  private head: Head | undefined;
  private readonly parents = new Map<bigint, Head | undefined>();

  private ensure(version: bigint): VersionState {
    const existing = this.states.get(version);
    if (existing) return existing;
    let previous: VersionState | undefined;
    if (this.head && version > this.head.version) previous = this.head.state;
    else {
      let predecessor: bigint | undefined;
      for (const candidate of this.versions)
        if (
          candidate < version &&
          (predecessor === undefined || candidate > predecessor)
        )
          predecessor = candidate;
      previous =
        predecessor === undefined ? undefined : this.states.get(predecessor);
    }
    const state: VersionState = {
      count: previous?.count,
      snapshot: previous?.snapshot,
      nextOrder: 0,
    };
    this.versions.add(version);
    this.states.set(version, state);
    if (!this.head || version > this.head.version) {
      this.parents.set(version, this.head);
      this.head = { version, state };
    }
    return state;
  }
  private state(version: bigint): VersionState {
    const state = this.states.get(version);
    if (!state) throw new Error('Native mirror version is not acknowledged');
    return state;
  }
  private complete(version: bigint): VersionState {
    const state = this.state(version);
    if (state.count === undefined || !state.snapshot)
      throw new Error('Native mirror requires an exact full snapshot');
    return state;
  }
  apply(
    version: bigint,
    records: readonly IForeignRenderRecord[],
    removed: readonly IForeignKey[] = []
  ): void {
    this.ensure(version);
    for (const record of records)
      this.put(publicKey(record.record.node.key), version, record.record);
    for (const key of removed) this.put(publicKey(key), version, null);
  }
  private memberships(key: string, fromVersion: bigint): Membership[] {
    const result: Membership[] = [];
    for (const [version, state] of this.states)
      if (version >= fromVersion && state.count !== undefined)
        result.push({
          version,
          state,
          present: this.reference(version, key, state) !== null,
        });
    if (
      this.head &&
      this.head.version >= fromVersion &&
      !this.states.has(this.head.version) &&
      this.head.state.count !== undefined
    )
      result.push({
        version: this.head.version,
        state: this.head.state,
        present:
          this.reference(this.head.version, key, this.head.state) !== null,
      });
    return result;
  }
  private updateCounts(key: string, before: readonly Membership[]): void {
    for (const { version, state, present } of before)
      if (state.count !== undefined)
        state.count +=
          Number(this.reference(version, key, state) !== null) -
          Number(present);
  }
  private put(
    key: string,
    version: bigint,
    record: IForeignRecordRef | null
  ): void {
    const state = this.state(version);
    const memberships = this.memberships(key, version);
    const previous = this.revision(version, key);
    let changed = this.changed.get(version);
    if (!changed) {
      changed = new Set();
      this.changed.set(version, changed);
    }
    if (!changed.has(key) && previous?.record) {
      let undo = this.undo.get(version);
      if (!undo) {
        undo = new Map();
        this.undo.set(version, undo);
      }
      undo.set(key, previous);
    }
    changed.add(key);
    let history = this.histories.get(key);
    if (!history) {
      history = [];
      this.histories.set(key, history);
    }
    const inserted =
      record !== null && previous?.record
        ? previous.inserted
        : { version, order: state.nextOrder++ };
    const revision: Revision = { version, record, inserted };
    const index = this.upperBound(history, version);
    if (index > 0 && history[index - 1].version === version)
      history[index - 1] = revision;
    else history.splice(index, 0, revision);
    this.updateCounts(key, memberships);
  }
  private upperBound(history: readonly Revision[], version: bigint): number {
    let start = 0,
      end = history.length;
    while (start < end) {
      const middle = start + ((end - start) >>> 1);
      if (history[middle].version <= version) start = middle + 1;
      else end = middle;
    }
    return start;
  }
  private revision(
    version: bigint,
    key: string,
    suppliedState?: VersionState
  ): Revision | undefined {
    const state = suppliedState ?? this.state(version),
      history = this.histories.get(key);
    if (!history) return;
    const index = this.upperBound(history, version);
    const revision = index === 0 ? undefined : history[index - 1];
    if (
      revision &&
      state.snapshot &&
      revision.version < state.snapshot.version &&
      !state.snapshot.order.has(key)
    )
      return;
    return revision;
  }
  private reference(
    version: bigint,
    key: string,
    state?: VersionState
  ): IForeignRecordRef | null {
    return this.revision(version, key, state)?.record ?? null;
  }
  get(version: bigint, key: string): IForeignRecordRef | null {
    return this.reference(version, key);
  }
  count(version: bigint): number {
    const count = this.complete(version).count;
    if (count === undefined)
      throw new Error('Native mirror requires an exact full snapshot');
    return count;
  }
  *keys(version: bigint): IterableIterator<string> {
    const snapshot = this.complete(version).snapshot;
    if (!snapshot)
      throw new Error('Native mirror requires an exact full snapshot');
    const entries: {
      key: string;
      baseline: number | undefined;
      stamp: Stamp;
    }[] = [];
    for (const key of this.histories.keys()) {
      const revision = this.revision(version, key);
      if (!revision?.record) continue;
      entries.push({
        key,
        baseline:
          revision.inserted.version <= snapshot.version
            ? snapshot.order.get(key)
            : undefined,
        stamp: revision.inserted,
      });
    }
    entries.sort((a, b) => {
      if (a.baseline !== undefined || b.baseline !== undefined) {
        if (a.baseline === undefined) return 1;
        if (b.baseline === undefined) return -1;
        return a.baseline - b.baseline;
      }
      if (a.stamp.version !== b.stamp.version)
        return a.stamp.version < b.stamp.version ? -1 : 1;
      return a.stamp.order - b.stamp.order;
    });
    for (const entry of entries) yield entry.key;
  }
  *records(version: bigint): IterableIterator<IForeignRecordRef> {
    for (const key of this.keys(version)) {
      const record = this.reference(version, key);
      if (record) yield record;
    }
  }
  /** Full enumeration is reserved for explicit initial/replacement snapshots. */
  replace(version: bigint, records: readonly IForeignRenderRecord[]): void {
    this.ensure(version);
    const order = new Map<string, number>();
    for (const record of records) {
      const key = publicKey(record.record.node.key);
      if (!order.has(key)) order.set(key, order.size);
    }
    for (const key of this.histories.keys())
      if (!order.has(key) && this.reference(version, key) !== null)
        this.put(key, version, null);
    for (const record of records)
      this.put(publicKey(record.record.node.key), version, record.record);
    const snapshot: Snapshot = { version, order };
    const states = [...this.states];
    if (this.head && !this.states.has(this.head.version))
      states.push([this.head.version, this.head.state]);
    for (const [candidate, state] of states) {
      if (
        candidate < version ||
        (state.snapshot && state.snapshot.version > version)
      )
        continue;
      state.snapshot = snapshot;
      let count = 0;
      for (const key of this.histories.keys())
        if (this.reference(candidate, key, state) !== null) count++;
      state.count = count;
    }
  }

  discard(version: bigint): void {
    if (!this.states.has(version) || this.head?.version !== version)
      throw new Error('Only the active head version can be discarded');
    const restoreHead = this.head?.version === version;
    const previousHead = restoreHead ? this.parents.get(version) : undefined;
    this.versions.delete(version);
    this.states.delete(version);
    if (restoreHead) this.head = undefined;
    this.parents.delete(version);
    const changed = this.changed.get(version) ?? new Set<string>();
    this.changed.delete(version);
    const undo = this.undo.get(version);
    this.undo.delete(version);
    for (const key of changed) {
      const previous = undo?.get(key);
      let history = this.histories.get(key);
      if (history === undefined) {
        if (!previous) continue;
        history = [];
        this.histories.set(key, history);
      }
      const memberships = this.memberships(key, version);
      const index = this.upperBound(history, version) - 1;
      if (index >= 0 && history[index].version === version)
        history.splice(index, 1);
      if (previous && previous.version !== version) {
        const at = this.upperBound(history, previous.version);
        if (at === 0 || history[at - 1].version !== previous.version)
          history.splice(at, 0, previous);
      }
      if (history.length === 0) this.histories.delete(key);
      else this.prune(key, history);
      this.updateCounts(key, memberships);
    }
    this.releaseWaiting(version);
    if (restoreHead) this.head = previousHead;
  }

  release(version: bigint): void {
    this.versions.delete(version);
    this.states.delete(version);
    this.parents.delete(version);
    const changed = this.changed.get(version);
    this.changed.delete(version);
    this.undo.delete(version);
    if (changed !== undefined) {
      for (const key of changed) {
        const history = this.histories.get(key);
        if (history !== undefined) this.prune(key, history);
      }
    }
    this.releaseWaiting(version);
  }

  private releaseWaiting(version: bigint): void {
    const waiting = this.waiting.get(version);
    this.waiting.delete(version);
    if (waiting === undefined) return;
    for (const key of waiting) {
      const history = this.histories.get(key);
      if (history !== undefined) this.prune(key, history);
    }
  }

  private prune(key: string, history: Revision[]): void {
    const retained: Revision[] = [];
    for (let index = 0; index < history.length; index++) {
      const revision = history[index];
      const next = history[index + 1];
      // The newest acknowledged record backs subsequent sparse versions even
      // when its allocation version is collected. It needs no per-version carry.
      if (next === undefined) {
        retained.push(revision);
        continue;
      }
      let owner: bigint | undefined;
      for (const version of this.versions) {
        if (
          version >= revision.version &&
          version < next.version &&
          (owner === undefined || version < owner)
        )
          owner = version;
      }
      if (owner === undefined) continue;
      retained.push(revision);
      if (owner !== revision.version) {
        let waiting = this.waiting.get(owner);
        if (waiting === undefined) {
          waiting = new Set();
          this.waiting.set(owner, waiting);
        }
        waiting.add(key);
      }
    }
    if (retained.length === 1 && retained[0].record === null)
      this.histories.delete(key);
    else this.histories.set(key, retained);
  }
}
