/**
 * A shared design's maps on a Loro document (the layout is defined by
 * `fig_engine::collab`): flat string maps of node states, blobs, and
 * images that changed since the collaboration began. Every peer opens the
 * stored `.fig` and applies them; concurrent writes to one node resolve
 * last-writer-wins.
 */

import type { EntryChange } from '@core/fig-engine/types';
import type { LoroDoc, LoroEventBatch } from 'loro-crdt';

/** The Loro root maps that hold a shared design. */
export const FIG_CONTAINERS = [
  'figMeta',
  'figNodes',
  'figBlobs',
  'figImages',
] as const;

/** The entry layout version this app reads and writes. */
export const FIG_FORMAT_VERSION = 1;

/** Commit origin of edits this peer made; its own events are not re-applied. */
export const LOCAL_EDIT_ORIGIN = 'fig-edit';

const META = 'figMeta';

const containerSet: ReadonlySet<string> = new Set(FIG_CONTAINERS);

/** An entry address: which map and key. */
export interface EntryKey {
  container: string;
  key: string;
}

/** The layout version the document was written with, once seeded. */
export function designFormat(doc: LoroDoc): number | undefined {
  const value = doc.getMap(META).get('format');
  const version = Number(value);
  return value === undefined || Number.isNaN(version) ? undefined : version;
}

/** The blob count every peer's file starts with, once a peer recorded it. */
export function baseBlobs(doc: LoroDoc): number | null {
  const value = Number(doc.getMap(META).get('baseBlobs'));
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/** Writes the format version into an empty document (the first snapshot). */
export function seedDesign(doc: LoroDoc): void {
  doc.getMap(META).set('format', String(FIG_FORMAT_VERSION));
  doc.commit({ origin: 'fig-seed' });
}

/** The current values of some entries, as changes to apply. */
export function readValues(
  doc: LoroDoc,
  keys: Iterable<EntryKey>
): EntryChange[] {
  return [...keys].map(({ container, key }) => {
    const value = doc.getMap(container).get(key);
    return { container, key, value: typeof value === 'string' ? value : null };
  });
}

/** Every entry, as a person opening the design applies them. */
export function readEntries(doc: LoroDoc): EntryChange[] {
  const keys: EntryKey[] = [];
  for (const container of FIG_CONTAINERS)
    for (const key of doc.getMap(container).keys())
      keys.push({ container, key });
  return readValues(doc, keys);
}

/** Writes changes in one commit tagged with `origin`. */
export function writeEntryChanges(
  doc: LoroDoc,
  changes: readonly EntryChange[],
  origin = LOCAL_EDIT_ORIGIN
): void {
  let wrote = false;
  for (const change of changes) {
    if (!containerSet.has(change.container)) continue;
    const map = doc.getMap(change.container);
    if (change.value === undefined || change.value === null)
      map.delete(change.key);
    else map.set(change.key, change.value);
    wrote = true;
  }
  if (wrote) doc.commit({ origin });
}

/** The entries a Loro event batch changed in the design's maps. */
export function changedKeys(doc: LoroDoc, batch: LoroEventBatch): EntryKey[] {
  const names = new Map<string, string>(
    FIG_CONTAINERS.map((name) => [doc.getMap(name).id, name])
  );
  const keys: EntryKey[] = [];
  for (const event of batch.events) {
    const container = names.get(event.target);
    if (!container || event.diff.type !== 'map') continue;
    for (const key of Object.keys(event.diff.updated))
      keys.push({ container, key });
  }
  return keys;
}
