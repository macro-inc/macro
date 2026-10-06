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

// The stored files the entries apply to. Entries hold what changed since
// the collaboration began, so they only apply to a file the collaboration
// produced: the one it began on, or one stored from it. `figMeta.base` is
// the fingerprint of the file the current entries began on, and
// `figMeta["file:<fingerprint>"]` names, for every file opened or stored
// since, the base it belongs to. A file stored outside the collaboration
// (a new upload, an AI edit) is not listed: its opener starts the shared
// design over on it, dropping the entries made on the file it replaced.

/** `figMeta` key of the fingerprint of the file the entries began on. */
export const BASE_KEY = 'base';

const fileKey = (fingerprint: string) => `file:${fingerprint}`;

/** Commit origin of changes to the stored files' record. */
export const STORED_FILE_ORIGIN = 'fig-stored-file';

/** The fingerprint of the file the shared entries began on, if recorded. */
export function designBase(doc: LoroDoc): string | undefined {
  const value = doc.getMap(META).get(BASE_KEY);
  return typeof value === 'string' ? value : undefined;
}

/**
 * Whether the shared entries apply to the stored file with `fingerprint`:
 * it is the file they began on or one stored from it, or the design was
 * shared before files were recorded.
 */
export function entriesApplyTo(doc: LoroDoc, fingerprint: string): boolean {
  const base = designBase(doc);
  return (
    base === undefined || doc.getMap(META).get(fileKey(fingerprint)) === base
  );
}

/**
 * Records that the file with `fingerprint` holds the shared entries (it
 * was opened, or is about to be stored); a design shared before files were
 * recorded begins on it. Returns whether anything was written.
 */
export function recordStoredFile(doc: LoroDoc, fingerprint: string): boolean {
  const meta = doc.getMap(META);
  let base = designBase(doc);
  if (base !== undefined && meta.get(fileKey(fingerprint)) === base)
    return false;
  if (base === undefined) {
    base = fingerprint;
    meta.set(BASE_KEY, base);
  }
  meta.set(fileKey(fingerprint), base);
  doc.commit({ origin: STORED_FILE_ORIGIN });
  return true;
}

/**
 * Starts the shared design over on a file stored outside it: drops every
 * entry (they were made on the file it replaced) and the facts about that
 * file, and begins on this one.
 */
export function restartOnFile(doc: LoroDoc, fingerprint: string): void {
  const meta = doc.getMap(META);
  for (const container of FIG_CONTAINERS) {
    if (container === META) continue;
    const map = doc.getMap(container);
    for (const key of map.keys()) map.delete(key);
  }
  // The format stays; what was known about the replaced file goes.
  for (const key of meta.keys()) if (key !== 'format') meta.delete(key);
  meta.set(BASE_KEY, fingerprint);
  meta.set(fileKey(fingerprint), fingerprint);
  doc.commit({ origin: STORED_FILE_ORIGIN });
}

/** A short, stable fingerprint of a stored file's bytes (SHA-256, hex). */
export async function fileFingerprint(bytes: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest.slice(0, 16)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
