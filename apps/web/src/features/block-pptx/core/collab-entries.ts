/**
 * A presentation's shared maps on a Loro document (the layout is defined by
 * `pptx_engine::collab`): flat string maps whose entries are parts, shapes,
 * relationships, content types, and slide positions. Peers merge edits to
 * different entries; concurrent writes to one entry resolve last-writer-wins.
 */

import type { CollabEntries, EntryChange } from '@core/pptx-engine/types';
import type { LoroDoc, LoroEventBatch } from 'loro-crdt';

/** The Loro root maps that hold a collaborative presentation. */
export const PPTX_CONTAINERS = [
  'pptxMeta',
  'pptxParts',
  'pptxTypes',
  'pptxRels',
  'pptxSlides',
  'pptxSlideOrder',
  'pptxShapes',
  'pptxShapeOrder',
] as const;

/** The entry layout version this app reads and writes. */
export const PPTX_FORMAT_VERSION = 1;

/** Commit origin of edits this peer made; its own events are not re-applied. */
export const LOCAL_EDIT_ORIGIN = 'pptx-edit';

const containerSet: ReadonlySet<string> = new Set(PPTX_CONTAINERS);

/** The layout version the document was written with, once seeded. */
export function presentationFormat(doc: LoroDoc): number | undefined {
  const value = doc.getMap('pptxMeta').get('format');
  const version = Number(value);
  return value === undefined || Number.isNaN(version) ? undefined : version;
}

/** Every entry of the shared maps. */
export function readEntries(doc: LoroDoc): CollabEntries {
  const entries: CollabEntries = {};
  for (const name of PPTX_CONTAINERS) {
    const map = doc.getMap(name);
    const values: Record<string, string> = {};
    for (const key of map.keys()) {
      const value = map.get(key);
      if (typeof value === 'string') values[key] = value;
    }
    entries[name] = values;
  }
  return entries;
}

/** Writes changes in one commit tagged with `origin`. */
export function writeEntryChanges(
  doc: LoroDoc,
  changes: readonly EntryChange[],
  origin = LOCAL_EDIT_ORIGIN
): void {
  if (changes.length === 0) return;
  for (const change of changes) {
    if (!containerSet.has(change.container)) continue;
    const map = doc.getMap(change.container);
    if (change.value === undefined || change.value === null)
      map.delete(change.key);
    else map.set(change.key, change.value);
  }
  doc.commit({ origin });
}

/** The entry changes a Loro event batch carries for the presentation maps. */
export function changesFromEvent(
  doc: LoroDoc,
  batch: LoroEventBatch
): EntryChange[] {
  const names = new Map<string, string>(
    PPTX_CONTAINERS.map((name) => [doc.getMap(name).id, name])
  );
  const changes: EntryChange[] = [];
  for (const event of batch.events) {
    const container = names.get(event.target);
    if (!container || event.diff.type !== 'map') continue;
    for (const [key, value] of Object.entries(event.diff.updated)) {
      changes.push({
        container,
        key,
        value: typeof value === 'string' ? value : null,
      });
    }
  }
  return changes;
}
