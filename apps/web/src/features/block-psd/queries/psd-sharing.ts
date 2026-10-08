/**
 * The engine side of a shared Photoshop document: this person's steps are
 * written to the Loro document as entry changes, and changes that arrive in
 * the document (other people's) are applied to the engine. Applying a
 * layer state can ask (`EditResult.wants`) for the tiles of a pixel
 * generation that arrived before it; those are read from the document and
 * applied too. Calls are made by the editor, in order with its own edits.
 */

import type { PsdEngine, SavedFile } from '@core/psd-engine/client';
import type { EditResult, EntryChange } from '@core/psd-engine/types';
import type { LoroDoc } from 'loro-crdt';
import type { PsdSharing } from '../context/psd-editor-context';
import {
  BASE_KEY,
  changedKeys,
  documentBase,
  ENGINE_CONTAINERS,
  type EntryKey,
  entriesApplyTo,
  fileFingerprint,
  LOCAL_EDIT_ORIGIN,
  readEntries,
  readValues,
  recordStoredFile,
  restartOnFile,
  SAVED_KEY,
  sessionsInUse,
  storedLayers,
  tilesWithPrefixes,
  writeEntryChanges,
} from '../core/collab-entries';
import { chooseSession, type Version, versionCovers } from '../core/presence';

/** Commit origin of the marker a person writes after storing the file. */
const STORED_ORIGIN = 'psd-stored';

const versionOf = (doc: LoroDoc): Version =>
  Object.fromEntries(doc.version().toJSON()) as Version;

export interface ShareOptions {
  /** `fileFingerprint` of the stored file the engine opened. */
  fingerprint: string;
  /** Layer id sessions the people present use. */
  sessionsTaken?: Iterable<number>;
  /**
   * Resolves once this person's changes so far reached the sync service,
   * or `false` when they could not (offline). Without it, they are taken
   * to have.
   */
  delivered?: () => Promise<boolean>;
}

/** Merges what a follow-up application changed into the first result. */
function mergeResults(a: EditResult, b: EditResult): EditResult {
  const dirty =
    a.dirty && b.dirty
      ? {
          x: Math.min(a.dirty.x, b.dirty.x),
          y: Math.min(a.dirty.y, b.dirty.y),
          w:
            Math.max(a.dirty.x + a.dirty.w, b.dirty.x + b.dirty.w) -
            Math.min(a.dirty.x, b.dirty.x),
          h:
            Math.max(a.dirty.y + a.dirty.h, b.dirty.y + b.dirty.h) -
            Math.min(a.dirty.y, b.dirty.y),
        }
      : (a.dirty ?? b.dirty);
  return {
    ...b,
    created: [...a.created, ...b.created],
    dirty,
    all: a.all || b.all,
    structure: a.structure || b.structure,
    wants: [],
  };
}

/**
 * Applies changes, then the tiles the layer states among them want (the
 * tiles of new generations that arrived earlier).
 */
async function applyWithWants(
  engine: Pick<PsdEngine, 'applyCollab'>,
  doc: LoroDoc,
  changes: EntryChange[]
): Promise<EditResult> {
  let result = await engine.applyCollab(changes);
  const wanted = tilesWithPrefixes(doc, result.wants);
  if (wanted.length > 0)
    result = mergeResults(result, await engine.applyCollab(wanted));
  return result;
}

/**
 * Starts sharing an open engine through `doc`: new layers get ids in a
 * session of this visit, and everything other people changed so far is
 * applied before the document is shown. When the stored file was replaced
 * outside the shared document (see `entriesApplyTo`), the document starts
 * over on it, and this person seeds it with every layer's state.
 */
export async function sharePsdEngine(
  engine: PsdEngine,
  doc: LoroDoc,
  options: ShareOptions
): Promise<PsdSharing> {
  const fresh =
    documentBase(doc) === undefined ||
    !entriesApplyTo(doc, options.fingerprint);
  if (!entriesApplyTo(doc, options.fingerprint))
    restartOnFile(doc, options.fingerprint);
  else recordStoredFile(doc, options.fingerprint);
  /** The file the entries this engine holds began on. */
  const base = documentBase(doc);
  const taken = sessionsInUse(doc);
  for (const s of options.sessionsTaken ?? []) taken.add(s);
  const session = chooseSession(taken);
  const seed = await engine.enableCollab(
    session,
    storedLayers(doc, options.fingerprint),
    fresh
  );
  writeEntryChanges(doc, seed);

  /** Entries changed in the document since they were given to the engine. */
  let pending = new Map<string, EntryKey>();
  /** The document version whose changes the engine holds. */
  let applied: Version = versionOf(doc);
  /** The version after the last change to the document's entries. */
  let lastChange: Version = applied;
  const incoming = new Set<() => void>();
  const storedElsewhere = new Set<() => void>();
  const replacedListeners = new Set<() => void>();
  let replaced = false;
  let closed = false;

  const isEntry = (k: EntryKey) => ENGINE_CONTAINERS.has(k.container);

  const unsubscribe = doc.subscribe((batch) => {
    if (batch.by === 'local' && batch.origin === LOCAL_EDIT_ORIGIN) return;
    const keys = changedKeys(doc, batch);
    if (
      !replaced &&
      batch.by !== 'local' &&
      keys.some((k) => k.container === 'psdMeta' && k.key === BASE_KEY) &&
      documentBase(doc) !== base
    ) {
      // Someone opened a file stored outside the document and started over
      // on it: what this engine holds no longer matches anyone's.
      replaced = true;
      for (const listener of replacedListeners) listener();
    }
    if (keys.some(isEntry)) lastChange = versionOf(doc);
    const stored = keys.some(
      (k) => k.container === 'psdMeta' && k.key === SAVED_KEY
    );
    for (const k of keys)
      if (isEntry(k)) pending.set(`${k.container}\u0000${k.key}`, k);
    if (stored && batch.by !== 'local') {
      const value = doc.getMap('psdMeta').get(SAVED_KEY);
      try {
        const version = JSON.parse(String(value)) as Version;
        if (versionCovers(version, lastChange))
          for (const listener of storedElsewhere) listener();
      } catch {
        // A marker this version can't read.
      }
    }
    if (pending.size > 0) for (const listener of incoming) listener();
  });

  // Everything shared before this person arrived.
  await applyWithWants(engine, doc, readEntries(doc));

  return {
    session,
    pull: async (): Promise<EditResult | null> => {
      if (pending.size === 0 || replaced) return null;
      // Values are read now, not from the events: a step this person wrote
      // after a remote event must win in the engine as it does in the
      // document.
      const changes = readValues(doc, pending.values());
      pending = new Map();
      applied = versionOf(doc);
      return applyWithWants(engine, doc, changes);
    },
    push: async () => {
      if (replaced) return;
      const changes = await engine.collabChanges();
      if (changes.length === 0) return;
      writeEntryChanges(doc, changes);
      if (pending.size === 0) applied = versionOf(doc);
      lastChange = versionOf(doc);
    },
    onIncoming: (listener) => {
      incoming.add(listener);
      return () => incoming.delete(listener);
    },
    appliedVersion: () => applied,
    willStore: async (saved: SavedFile) => {
      if (closed || replaced) return false;
      // Listed before it is stored, and known to the sync service, so
      // whoever opens the stored file finds it is the document's own.
      recordStoredFile(doc, await fileFingerprint(saved.bytes), saved.layers);
      return (await options.delivered?.()) ?? true;
    },
    markStored: (version) => {
      // The last save can finish after the document closed.
      if (closed) return;
      doc.getMap('psdMeta').set(SAVED_KEY, JSON.stringify(version));
      doc.commit({ origin: STORED_ORIGIN });
    },
    onStoredElsewhere: (listener) => {
      storedElsewhere.add(listener);
      return () => storedElsewhere.delete(listener);
    },
    onReplaced: (listener) => {
      replacedListeners.add(listener);
      return () => replacedListeners.delete(listener);
    },
    close: () => {
      closed = true;
      unsubscribe();
      incoming.clear();
      storedElsewhere.clear();
      replacedListeners.clear();
    },
  };
}
