/**
 * The engine side of a shared Illustrator document: this person's edits
 * are written to the Loro document as entry changes, and changes that
 * arrive in the document (other people) are applied to the engine's
 * workers. Calls are made by the editor, in order with its own edits.
 */

import type { AiEngine } from '@core/ai-engine/client';
import type { EditResult } from '@core/ai-engine/types';
import type { LoroDoc } from 'loro-crdt';
import type { AiSharing } from '../context/ai-editor-context';
import {
  BASE_KEY,
  changedKeys,
  documentBase,
  type EntryKey,
  entriesApplyTo,
  fileFingerprint,
  hasDocumentState,
  LOCAL_EDIT_ORIGIN,
  META,
  readEntries,
  readValues,
  recordStoredFile,
  restartOnFile,
  SAVED_KEY,
  writeEntryChanges,
} from '../core/collab-entries';
import { pickSession, type Version, versionCovers } from '../core/presence';

/** Commit origin of the marker a person writes after storing the file. */
const STORED_ORIGIN = 'ai-stored';

const versionOf = (doc: LoroDoc): Version =>
  Object.fromEntries(doc.version().toJSON()) as Version;

export interface ShareOptions {
  /** `fileFingerprint` of the stored file the engine opened. */
  fingerprint: string;
  /** The id sessions of the people present, which this person avoids. */
  takenSessions: () => number[];
  /**
   * Resolves once this person's changes so far reached the sync service,
   * or `false` when they could not (offline). Without it, they are taken
   * to have.
   */
  delivered?: () => Promise<boolean>;
}

/** Reads a stored file's version marker (`null` when unreadable). */
function readVersion(value: unknown): Version | null {
  try {
    const parsed: unknown = JSON.parse(String(value));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Version)
      : null;
  } catch {
    return null;
  }
}

/**
 * Starts sharing an open engine through `doc`: new objects get ids in a
 * session of this visit, and everything other people changed so far is
 * applied before the document is shown. When the stored file was replaced
 * outside the shared document (see `entriesApplyTo`), it starts over on
 * it instead.
 */
export async function shareAiEngine(
  engine: AiEngine,
  doc: LoroDoc,
  options: ShareOptions
): Promise<AiSharing> {
  if (entriesApplyTo(doc, options.fingerprint))
    recordStoredFile(doc, options.fingerprint);
  else restartOnFile(doc, options.fingerprint);
  /** The file the entries this engine holds began on. */
  const base = documentBase(doc);
  const session = pickSession(options.takenSessions());
  const seed = await engine.enableCollab(session, !hasDocumentState(doc));
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

  const isEntry = (k: EntryKey) => k.container !== META;

  const unsubscribe = doc.subscribe((batch) => {
    if (batch.by === 'local' && batch.origin === LOCAL_EDIT_ORIGIN) return;
    const keys = changedKeys(doc, batch);
    const remote = batch.by !== 'local';
    if (
      !replaced &&
      remote &&
      keys.some((k) => k.container === META && k.key === BASE_KEY) &&
      documentBase(doc) !== base
    ) {
      // Someone opened a file stored outside the document and started over
      // on it: what this engine holds no longer matches anyone's.
      replaced = true;
      for (const listener of replacedListeners) listener();
    }
    if (keys.some(isEntry)) lastChange = versionOf(doc);
    for (const k of keys)
      if (isEntry(k)) pending.set(`${k.container}\u0000${k.key}`, k);
    const stored = keys.some(
      (k) => k.container === META && k.key === SAVED_KEY
    );
    if (stored && remote) {
      const version = readVersion(doc.getMap(META).get(SAVED_KEY));
      if (version && versionCovers(version, lastChange))
        for (const listener of storedElsewhere) listener();
    }
    if (pending.size > 0) for (const listener of incoming) listener();
  });

  // Everything shared before this person arrived.
  await engine.applyRemote(readEntries(doc));

  return {
    session,
    pull: async (): Promise<EditResult | null> => {
      if (pending.size === 0) return null;
      // Values are read now, not from the events: an edit this person wrote
      // after a remote event must win in the engine as it does in the
      // document.
      const changes = readValues(doc, pending.values());
      pending = new Map();
      applied = versionOf(doc);
      return engine.applyRemote(changes);
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
      // whoever opens the stored file finds it is the document's own.
      recordStoredFile(doc, await fileFingerprint(bytes));
      return (await options.delivered?.()) ?? true;
    },
    markStored: (version) => {
      // The last save can finish after the document closed.
      if (closed) return;
      doc.getMap(META).set(SAVED_KEY, JSON.stringify(version));
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
