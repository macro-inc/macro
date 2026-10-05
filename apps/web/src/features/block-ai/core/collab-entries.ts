/**
 * A shared Illustrator document's maps on a Loro document (the layout is
 * defined by `ai_engine::collab`): flat string maps of node states, the
 * document state, and placed images that changed since the collaboration
 * began. Every person opens the stored file and applies them; concurrent
 * writes to one node resolve last-writer-wins.
 *
 * The stored-file record (`base`, `file:<fingerprint>`, `saved`) works as
 * the Figma editor's does (`block-fig/core/collab-entries.ts`).
 */

import type { LoroDoc, LoroEventBatch } from 'loro-crdt';

export { fileFingerprint } from '@app/features/block-fig/core/collab-entries';

/** The Loro root maps that hold a shared document. */
export const AI_CONTAINERS = [
  'aiMeta',
  'aiDoc',
  'aiNodes',
  'aiImages',
] as const;

/** The entry layout version this app reads and writes. */
export const AI_FORMAT_VERSION = 1;

/** Commit origin of edits this person made; their own events are not re-applied. */
export const LOCAL_EDIT_ORIGIN = 'ai-edit';

export const META = 'aiMeta';
const DOC = 'aiDoc';

const containerSet: ReadonlySet<string> = new Set(AI_CONTAINERS);

/** A change to one entry: `value` null deletes it. */
export interface EntryChange {
  container: string;
  key: string;
  value?: string | null;
}

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

/** Whether someone already wrote the document state (artboards). */
export function hasDocumentState(doc: LoroDoc): boolean {
  return doc.getMap(DOC).get('state') !== undefined;
}

/** Writes the format version into an empty document (the first snapshot). */
export function seedDocument(doc: LoroDoc): void {
  doc.getMap(META).set('format', String(AI_FORMAT_VERSION));
  doc.commit({ origin: 'ai-seed' });
}

/** `aiMeta` key of the fingerprint of the file the entries began on. */
export const BASE_KEY = 'base';

/** `aiMeta` key of the version a stored file holds. */
export const SAVED_KEY = 'saved';

const fileKey = (fingerprint: string) => `file:${fingerprint}`;

/** Commit origin of changes to the stored files' record. */
export const STORED_FILE_ORIGIN = 'ai-stored-file';

/** The fingerprint of the file the shared entries began on, if recorded. */
export function documentBase(doc: LoroDoc): string | undefined {
  const value = doc.getMap(META).get(BASE_KEY);
  return typeof value === 'string' ? value : undefined;
}

/**
 * Whether the shared entries apply to the stored file with `fingerprint`:
 * it is the file they began on or one stored from it, or the document was
 * shared before files were recorded.
 */
export function entriesApplyTo(doc: LoroDoc, fingerprint: string): boolean {
  const base = documentBase(doc);
  return (
    base === undefined || doc.getMap(META).get(fileKey(fingerprint)) === base
  );
}

/**
 * Records that the file with `fingerprint` holds the shared entries (it
 * was opened, or is about to be stored); a document shared before files
 * were recorded begins on it. Returns whether anything was written.
 */
export function recordStoredFile(doc: LoroDoc, fingerprint: string): boolean {
  const meta = doc.getMap(META);
  let base = documentBase(doc);
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
 * Starts the shared document over on a file stored outside it: drops every
 * entry (they were made on the file it replaced) and the facts about that
 * file, and begins on this one.
 */
export function restartOnFile(doc: LoroDoc, fingerprint: string): void {
  const meta = doc.getMap(META);
  for (const container of AI_CONTAINERS) {
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

/** Every entry the engine applies (not the stored-file record). */
export function readEntries(doc: LoroDoc): EntryChange[] {
  const keys: EntryKey[] = [];
  for (const container of AI_CONTAINERS) {
    if (container === META) continue;
    for (const key of doc.getMap(container).keys())
      keys.push({ container, key });
  }
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
    AI_CONTAINERS.map((name) => [doc.getMap(name).id, name])
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
