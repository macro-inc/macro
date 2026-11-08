// Observe actual shipping storage completions without changing their transaction rules.
import type { SnapshotStore } from '@macro-inc/collaboration/collab/snapshot-store';
import type { WALEntry, WALStore } from '@macro-inc/collaboration/collab/wal';
import { activity } from './runtime';

export class ObservedStore implements WALStore<Uint8Array> {
  constructor(private readonly inner: WALStore<Uint8Array>) {}
  append(update: Uint8Array) {
    return activity.observe(this.inner.append(update));
  }
  getAll(): Promise<WALEntry<Uint8Array>[]> {
    return activity.observe(this.inner.getAll());
  }
  markDelivered(ids: number[]) {
    return activity.observe(this.inner.markDelivered(ids));
  }
  pruneDelivered() {
    return activity.observe(this.inner.pruneDelivered());
  }
  pruneExpired(ttl: number) {
    return activity.observe(this.inner.pruneExpired(ttl));
  }
  count() {
    return activity.observe(this.inner.count());
  }
}
export class ObservedSnapshots implements SnapshotStore<Uint8Array> {
  constructor(private readonly inner: SnapshotStore<Uint8Array>) {}
  load() {
    return activity.observe(this.inner.load());
  }
  save(bytes: Uint8Array) {
    return activity.observe(this.inner.save(bytes));
  }
  delete() {
    return activity.observe(this.inner.delete());
  }
}
