/**
 * The engine side of a shared design: this person's edits are written to
 * the Loro document as entry changes, and changes that arrive in the
 * document (other people) are applied to the engine's workers. Calls are
 * made by the editor, in order with its own edits.
 */

import type { EditResult, FigEngine } from '@core/fig-engine/client';
import type { EntryChange } from '@core/fig-engine/types';
import type { LoroDoc } from 'loro-crdt';
import type { FigSharing } from '../context/fig-viewer-context';
import {
  BASE_KEY,
  baseBlobs,
  changedKeys,
  designBase,
  type EntryKey,
  entriesApplyTo,
  fileFingerprint,
  LOCAL_EDIT_ORIGIN,
  readEntries,
  readValues,
  recordStoredFile,
  restartOnFile,
  writeEntryChanges,
} from '../core/collab-entries';
import { newGuidSession, type Version, versionCovers } from '../core/presence';

/** Commit origin of the marker a person writes after storing the file. */
const STORED_ORIGIN = 'fig-stored';

const versionOf = (doc: LoroDoc): Version =>
  Object.fromEntries(doc.version().toJSON()) as Version;

export interface ShareOptions {
  /** `fileFingerprint` of the stored file the engine opened. */
  fingerprint: string;
  /**
   * Resolves once this person's changes so far reached the sync service,
   * or `false` when they could not (offline). Without it, they are taken
   * to have.
   */
  delivered?: () => Promise<boolean>;
}

/**
 * Starts sharing an open engine through `doc`: new layers get ids in a
 * session of this visit, and everything other people changed so far is
 * applied before the design is shown. When the stored file was replaced
 * outside the shared design (see `entriesApplyTo`), the design starts over
 * on it instead.
 */
export async function shareFigEngine(
  engine: FigEngine,
  doc: LoroDoc,
  options: ShareOptions
): Promise<FigSharing> {
  if (entriesApplyTo(doc, options.fingerprint))
    recordStoredFile(doc, options.fingerprint);
  else restartOnFile(doc, options.fingerprint);
  /** The file the entries this engine holds began on. */
  const base = designBase(doc);
  const meta = await engine.enableCollab(newGuidSession(), baseBlobs(doc));
  writeEntryChanges(doc, meta);

  /** Entries changed in the document since they were given to the engine. */
  let pending = new Map<string, EntryKey>();
  /** The document version whose changes the engine holds. */
  let applied: Version = versionOf(doc);
  /** The version after the last change to the design's entries. */
  let lastChange: Version = applied;
  const incoming = new Set<() => void>();
  const storedElsewhere = new Set<() => void>();
  const replacedListeners = new Set<() => void>();
  let replaced = false;
  let closed = false;

  const isEntry = (k: EntryKey) => k.container !== 'figMeta';

  const unsubscribe = doc.subscribe((batch) => {
    if (batch.by === 'local' && batch.origin === LOCAL_EDIT_ORIGIN) return;
    const keys = changedKeys(doc, batch);
    if (
      !replaced &&
      batch.by !== 'local' &&
      keys.some((k) => k.container === 'figMeta' && k.key === BASE_KEY) &&
      designBase(doc) !== base
    ) {
      // Someone opened a file stored outside the design and started over
      // on it: what this engine holds no longer matches anyone's.
      replaced = true;
      for (const listener of replacedListeners) listener();
    }
    if (keys.some(isEntry)) lastChange = versionOf(doc);
    const stored = keys.some(
      (k) => k.container === 'figMeta' && k.key === 'saved'
    );
    for (const k of keys)
      if (isEntry(k)) pending.set(`${k.container}\u0000${k.key}`, k);
    if (stored && batch.by !== 'local') {
      const value = doc.getMap('figMeta').get('saved');
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
  const entries = readEntries(doc).filter(
    (entry) => entry.container !== 'figMeta'
  );
  if (entries.length > 0) await engine.applyRemote(0, entries);

  return {
    pull: async (page: number): Promise<EditResult | null> => {
      if (pending.size === 0) return null;
      // Values are read now, not from the events: an edit this person wrote
      // after a remote event must win in the engine as it does in the
      // document.
      const changes: EntryChange[] = readValues(doc, pending.values());
      pending = new Map();
      applied = versionOf(doc);
      return engine.applyRemote(page, changes);
    },
    push: async () => {
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
    willStore: async (bytes) => {
      if (closed || replaced) return false;
      // Listed before it is stored, and known to the sync service, so
      // whoever opens the stored file finds it is the design's own.
      recordStoredFile(doc, await fileFingerprint(bytes));
      return (await options.delivered?.()) ?? true;
    },
    markStored: (version) => {
      // The last save can finish after the design closed.
      if (closed) return;
      doc.getMap('figMeta').set('saved', JSON.stringify(version));
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
