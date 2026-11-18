import {
  type NativeChecklistBar,
  type NativeChecklistDelivery,
  type NativeChecklistKey,
  type NativeChecklistPresentation,
  nativeChecklistDelivery,
} from './native-plan-schema';

type ListUpdate = Extract<
  NativeChecklistDelivery,
  { kind: 'delta' }
>['lists'][number];
type Patch = Extract<ListUpdate, { kind: 'patch' }>['changes'];
export type NativeChecklistList = {
  readonly key: NativeChecklistKey;
  readonly result: NativeChecklistPresentation;
};
function sameKey(a: NativeChecklistKey, b: NativeChecklistKey) {
  return a.index === b.index && a.generation === b.generation;
}
function indexOf<T extends { key: NativeChecklistKey }>(
  items: T[],
  key: NativeChecklistKey
) {
  return items.findIndex((item) => sameKey(item.key, key));
}
function remove<T extends { key: NativeChecklistKey }>(
  items: T[],
  key: NativeChecklistKey
) {
  const index = indexOf(items, key);
  if (index < 0) throw new Error('Checklist patch removes an unknown key');
  items.splice(index, 1);
}
function place<T extends { key: NativeChecklistKey }>(
  items: T[],
  item: T,
  after: NativeChecklistKey | null
) {
  if (after && sameKey(item.key, after))
    throw new Error('Checklist patch places a key after itself');
  const previous = indexOf(items, item.key);
  if (previous >= 0) items.splice(previous, 1);
  const anchor = after === null ? -1 : indexOf(items, after);
  if (after !== null && anchor < 0)
    throw new Error('Checklist patch has an unknown preceding key');
  items.splice(anchor + 1, 0, item);
}
function validateKeys(
  items: ReadonlyArray<{ key: NativeChecklistKey }>,
  generation: number
) {
  const seen = new Set<number>();
  for (const item of items) {
    if (item.key.generation !== generation || seen.has(item.key.index))
      throw new Error('Checklist presentation has stale or duplicate keys');
    seen.add(item.key.index);
  }
}
function patchRows(
  before: NativeChecklistBar['rows'],
  changes: Patch['rows'],
  generation: number
) {
  const rows = [...before];
  for (const change of changes ?? []) {
    if (
      change.key.generation !== generation ||
      (change.kind === 'place' &&
        change.after !== null &&
        change.after.generation !== generation)
    )
      throw new Error('Checklist row patch has a stale key');
    switch (change.kind) {
      case 'remove':
        remove(rows, change.key);
        break;
      case 'place':
        place(rows, { key: change.key, dimmed: change.dimmed }, change.after);
        break;
      case 'dim': {
        const index = indexOf(rows, change.key);
        if (index < 0) throw new Error('Checklist patch dims an unknown row');
        rows[index] = { key: change.key, dimmed: change.dimmed };
        break;
      }
    }
  }
  return rows;
}
function patchItems(
  before: NativeChecklistBar['items'],
  changes: Patch['items'],
  generation: number
) {
  const items = [...before];
  for (const change of changes ?? []) {
    const key = change.kind === 'remove' ? change.key : change.item.key;
    if (
      key.generation !== generation ||
      (change.kind === 'place' &&
        change.after !== null &&
        change.after.generation !== generation)
    )
      throw new Error('Checklist item patch has a stale key');
    switch (change.kind) {
      case 'remove':
        remove(items, change.key);
        break;
      case 'place':
        place(items, change.item, change.after);
        break;
      case 'update': {
        const index = indexOf(items, change.item.key);
        if (index < 0)
          throw new Error('Checklist patch updates an unknown item');
        items[index] = change.item;
        break;
      }
    }
  }
  return items;
}
function patchBar(
  before: NativeChecklistBar,
  changes: Patch,
  generation: number
): NativeChecklistBar {
  return {
    kind: 'planned',
    settings: changes.settings ?? before.settings,
    active: changes.active ?? before.active,
    filterCount: changes.filterCount ?? before.filterCount,
    hasTasks: changes.hasTasks ?? before.hasTasks,
    progress: changes.progress ?? before.progress,
    rows: patchRows(before.rows, changes.rows, generation),
    items: patchItems(before.items, changes.items, generation),
  };
}

/** Applies native presentation edits only. It never derives filters, rows or counts. */
export class NativeChecklistPlanState {
  private retired = false;
  private sequence: bigint | undefined;
  private sequenceGeneration: number | undefined;
  private previousReceipt: string | undefined;
  private generation: number | undefined;
  private resetSeen = false;
  private lists = new Map<number, NativeChecklistList>();

  current(): ReadonlyMap<number, NativeChecklistList> {
    return this.lists;
  }

  observedSequence(currentGeneration: number): string | undefined {
    if (
      this.retired ||
      !this.resetSeen ||
      this.generation !== currentGeneration ||
      this.sequenceGeneration !== currentGeneration
    )
      return undefined;
    return this.sequence?.toString();
  }

  /** Terminal UI cleanup; the native producer retains its own delivery authority. */
  retire(): void {
    this.retired = true;
    this.lists = new Map();
    this.previousReceipt = undefined;
  }

  receive(
    value: unknown,
    currentGeneration: number
  ): 'updated' | 'duplicate' | 'different-generation' {
    if (this.retired) throw new Error('Checklist presentation is retired');
    const delivery = nativeChecklistDelivery.parse(value);
    const sequence = BigInt(delivery.sequence);
    const receipt = JSON.stringify(delivery);
    if (this.generation !== currentGeneration) {
      this.generation = currentGeneration;
      this.resetSeen = false;
      this.lists = new Map();
    }
    if (sequence === this.sequence) {
      if (receipt !== this.previousReceipt)
        throw new Error('Conflicting checklist delivery sequence');
      return 'duplicate';
    }
    if (this.sequence !== undefined && sequence !== this.sequence + 1n)
      throw new Error('Checklist delivery sequence gap');
    // Older retained receipts can cross packet boundaries after a real replacement.
    // They advance only the receipt cursor, never the current view's DOM baseline.
    if (delivery.generation !== currentGeneration) {
      this.sequence = sequence;
      this.sequenceGeneration = delivery.generation;
      this.previousReceipt = receipt;
      return 'different-generation';
    }
    const next =
      delivery.kind === 'cleared' || delivery.reset
        ? new Map<number, NativeChecklistList>()
        : new Map(this.lists);
    if (delivery.kind === 'delta') {
      if (!this.resetSeen && !delivery.reset)
        throw new Error('Checklist delta requires a current-generation reset');
      for (const update of delivery.lists) {
        if (update.listKey.generation !== currentGeneration)
          throw new Error('Checklist list update has a stale key');
        if (update.kind === 'remove') {
          if (!next.delete(update.listKey.index))
            throw new Error('Checklist removes an unknown list');
        } else if (update.kind === 'replace') {
          if (update.result.kind === 'planned') {
            validateKeys(update.result.items, currentGeneration);
            validateKeys(update.result.rows, currentGeneration);
          }
          next.set(update.listKey.index, {
            key: update.listKey,
            result: update.result,
          });
        } else {
          const before = next.get(update.listKey.index);
          if (!before || before.result.kind !== 'planned')
            throw new Error(
              'Checklist patch requires an existing planned list'
            );
          next.set(update.listKey.index, {
            key: update.listKey,
            result: patchBar(before.result, update.changes, currentGeneration),
          });
        }
      }
    }
    this.lists = next;
    this.resetSeen = delivery.kind === 'delta';
    this.sequence = sequence;
    this.sequenceGeneration = delivery.generation;
    this.previousReceipt = receipt;
    return 'updated';
  }
}
