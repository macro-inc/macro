/**
 * A shared Photoshop document's maps on a Loro document (the layout is
 * defined by `psd_engine::collab`): flat string maps of the document's
 * state, each layer's state, and pixel tiles that changed since the
 * collaboration began. Every person opens the stored file and applies
 * them; concurrent writes to one layer resolve last-writer-wins.
 *
 * `psdMeta` also records the stored files the entries apply to (as the
 * Figma editor does): `base` is the fingerprint of the file the entries
 * began on, `file:<fingerprint>` names, for every file opened or stored
 * since, the base it belongs to, and `layers:<fingerprint>` holds each
 * layer's tile grid in that file, which whoever opens it passes to the
 * engine. A file stored outside the collaboration (a new upload, an AI
 * edit) is not listed: its opener starts the shared document over on it.
 */

import type { EntryChange } from '@core/psd-engine/types';
import type { LoroDoc, LoroEventBatch } from 'loro-crdt';

export { fileFingerprint } from '@app/features/block-fig/core/collab-entries';

/** The Loro root maps that hold a shared document. */
export const PSD_CONTAINERS = [
  'psdMeta',
  'psdDoc',
  'psdLayers',
  'psdTiles',
] as const;

/** The maps the engine reads (the rest is the app's bookkeeping). */
export const ENGINE_CONTAINERS: ReadonlySet<string> = new Set([
  'psdDoc',
  'psdLayers',
  'psdTiles',
]);

/** The entry layout version this app reads and writes. */
export const PSD_FORMAT_VERSION = 1;

/** Commit origin of edits this person made; their own events are not re-applied. */
export const LOCAL_EDIT_ORIGIN = 'psd-edit';

/** Commit origin of changes to the stored files' record. */
export const STORED_FILE_ORIGIN = 'psd-stored-file';

const META = 'psdMeta';
const TILES = 'psdTiles';
const LAYERS = 'psdLayers';

/** `psdMeta` key of the fingerprint of the file the entries began on. */
export const BASE_KEY = 'base';

/** `psdMeta` key of the version the last stored file holds. */
export const SAVED_KEY = 'saved';

const fileKey = (fingerprint: string) => `file:${fingerprint}`;
const layersKey = (fingerprint: string) => `layers:${fingerprint}`;

const containerSet: ReadonlySet<string> = new Set(PSD_CONTAINERS);

/** An entry address: which map and key. */
export interface EntryKey {
  container: string;
  key: string;
}

/** The layout version the document was written with, once seeded. */
export function documentFormat(doc: LoroDoc): number | undefined {
  const value = doc.getMap(META).get('format');
  const version = Number(value);
  return value === undefined || Number.isNaN(version) ? undefined : version;
}

/** Writes the format version into an empty document (the first snapshot). */
export function seedDocument(doc: LoroDoc): void {
  doc.getMap(META).set('format', String(PSD_FORMAT_VERSION));
  doc.commit({ origin: 'psd-seed' });
}

/** The fingerprint of the file the shared entries began on, if recorded. */
export function documentBase(doc: LoroDoc): string | undefined {
  const value = doc.getMap(META).get(BASE_KEY);
  return typeof value === 'string' ? value : undefined;
}

/**
 * Whether the shared entries apply to the stored file with `fingerprint`:
 * it is the file they began on or one stored from it, or nothing was
 * recorded yet.
 */
export function entriesApplyTo(doc: LoroDoc, fingerprint: string): boolean {
  const base = documentBase(doc);
  return (
    base === undefined || doc.getMap(META).get(fileKey(fingerprint)) === base
  );
}

/** The layer grids recorded for a stored file (`layers:<fingerprint>`). */
export function storedLayers(
  doc: LoroDoc,
  fingerprint: string
): string | null {
  const value = doc.getMap(META).get(layersKey(fingerprint));
  return typeof value === 'string' ? value : null;
}

/**
 * Records that the file with `fingerprint` holds the shared entries (it
 * was opened, or is about to be stored), with its layer grids when given;
 * a document shared before any file was recorded begins on it. Returns
 * whether anything was written.
 */
export function recordStoredFile(
  doc: LoroDoc,
  fingerprint: string,
  layers?: string
): boolean {
  const meta = doc.getMap(META);
  let base = documentBase(doc);
  const known = base !== undefined && meta.get(fileKey(fingerprint)) === base;
  const sameLayers =
    layers === undefined || meta.get(layersKey(fingerprint)) === layers;
  if (known && sameLayers) return false;
  if (base === undefined) {
    base = fingerprint;
    meta.set(BASE_KEY, base);
  }
  meta.set(fileKey(fingerprint), base);
  if (layers !== undefined) meta.set(layersKey(fingerprint), layers);
  doc.commit({ origin: STORED_FILE_ORIGIN });
  return true;
}

/**
 * Starts the shared document over on a file stored outside it: drops every
 * entry (they were made on the file it replaced) and what was known about
 * that file, and begins on this one.
 */
export function restartOnFile(doc: LoroDoc, fingerprint: string): void {
  const meta = doc.getMap(META);
  for (const container of PSD_CONTAINERS) {
    if (container === META) continue;
    const map = doc.getMap(container);
    for (const key of map.keys()) map.delete(key);
  }
  for (const key of meta.keys()) if (key !== 'format') meta.delete(key);
  meta.set(BASE_KEY, fingerprint);
  meta.set(fileKey(fingerprint), fingerprint);
  doc.commit({ origin: STORED_FILE_ORIGIN });
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

/** Every engine entry, as a person opening the document applies them. */
export function readEntries(doc: LoroDoc): EntryChange[] {
  const keys: EntryKey[] = [];
  for (const container of ENGINE_CONTAINERS)
    for (const key of doc.getMap(container).keys())
      keys.push({ container, key });
  return readValues(doc, keys);
}

/**
 * The tiles whose keys start with any of `prefixes` (what an applied
 * layer state `wants`: the tiles of a generation that arrived before it).
 */
export function tilesWithPrefixes(
  doc: LoroDoc,
  prefixes: readonly string[]
): EntryChange[] {
  if (prefixes.length === 0) return [];
  const keys: EntryKey[] = [];
  for (const key of doc.getMap(TILES).keys())
    if (prefixes.some((p) => key.startsWith(p)))
      keys.push({ container: TILES, key });
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

/** The entries a Loro event batch changed in the document's maps. */
export function changedKeys(doc: LoroDoc, batch: LoroEventBatch): EntryKey[] {
  const names = new Map<string, string>(
    PSD_CONTAINERS.map((name) => [doc.getMap(name).id, name])
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

/** Layer id sessions (the id's high 16 bits) the shared layers use. */
export function sessionsInUse(doc: LoroDoc): Set<number> {
  const used = new Set<number>();
  for (const key of doc.getMap(LAYERS).keys()) {
    const id = Number(key);
    if (Number.isInteger(id) && id > 0) used.add(id >>> 16);
  }
  return used;
}
