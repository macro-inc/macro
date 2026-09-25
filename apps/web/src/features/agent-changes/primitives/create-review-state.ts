/**
 * The reviewer's state for a changeset: collapsed diffs, the file the tree
 * last pointed at, and the notes queued for the agent.
 *
 * Collapsed diffs belong to one capture: a new changeset expands them.
 * Notes outlive captures, since they are the reviewer's words,
 * and are only cleared by sending or deleting them.
 */

import { type Accessor, createMemo, createSignal } from 'solid-js';
import type { Changeset } from '../core/changeset';
import {
  type NoteAnchor,
  noteAnchorKey,
  queuedNotes,
  type ReviewNote,
} from '../core/review-notes';
import { createPersistedSessionState } from './create-persisted-session-state';

export type ReviewController = {
  collapsed: Accessor<ReadonlySet<string>>;
  isCollapsed: (path: string) => boolean;
  toggleCollapsed: (path: string) => void;
  /** Collapse every diff, or expand them all when none is open. */
  toggleAllCollapsed: () => void;
  anyExpanded: Accessor<boolean>;

  /** The file the tree last selected; the stack scrolls to it. */
  active: Accessor<string | undefined>;
  /** Select a file: it uncollapses and becomes the scroll target. */
  activate: (path: string) => void;

  notes: Accessor<ReviewNote[]>;
  queued: Accessor<ReviewNote[]>;
  /** Where a note is being written, if one is. */
  composing: Accessor<NoteAnchor | undefined>;
  openNote: (anchor: NoteAnchor) => void;
  cancelNote: () => void;
  addNote: (anchor: NoteAnchor, text: string) => void;
  updateNote: (id: string, text: string) => void;
  removeNote: (id: string) => void;
  /** Stamp every queued note as sent, returning what was sent. */
  markQueuedSent: () => ReviewNote[];
};

type StoredReview = {
  /** The capture `collapsed` was made against. */
  changesetId: string | undefined;
  collapsed: string[];
  notes: ReviewNote[];
};

const SIDES = new Set(['additions', 'deletions']);

function isNote(raw: unknown): raw is ReviewNote {
  if (typeof raw !== 'object' || raw === null) return false;
  const note = raw as Record<string, unknown>;
  return (
    typeof note.id === 'string' &&
    typeof note.path === 'string' &&
    typeof note.side === 'string' &&
    SIDES.has(note.side) &&
    typeof note.lineNumber === 'number' &&
    typeof note.endLineNumber === 'number' &&
    typeof note.text === 'string' &&
    typeof note.createdAt === 'string' &&
    (note.sentAt === undefined || typeof note.sentAt === 'string')
  );
}

function strings(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string')
    : [];
}

function parseStored(raw: unknown): StoredReview | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const stored = raw as Record<string, unknown>;
  return {
    changesetId:
      typeof stored.changesetId === 'string' ? stored.changesetId : undefined,
    collapsed: strings(stored.collapsed),
    notes: Array.isArray(stored.notes) ? stored.notes.filter(isNote) : [],
  };
}

function toggleIn(list: readonly string[], path: string): string[] {
  return list.includes(path)
    ? list.filter((item) => item !== path)
    : [...list, path];
}

export function createReviewState(options: {
  sessionId: Accessor<string | undefined>;
  changeset: Accessor<Changeset | undefined>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  now?: () => string;
  newId?: () => string;
}): ReviewController {
  const now = options.now ?? (() => new Date().toISOString());
  const newId =
    options.newId ??
    (() =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const [stored, setStored] = createPersistedSessionState<StoredReview>({
    sessionId: options.sessionId,
    namespace: 'agent-changes:review',
    initial: () => ({
      changesetId: undefined,
      collapsed: [],
      notes: [],
    }),
    parse: parseStored,
    storage: options.storage,
  });
  const [active, setActive] = createSignal<string | undefined>();
  const [composing, setComposing] = createSignal<NoteAnchor | undefined>();

  const changesetId = () => options.changeset()?.id;
  const paths = createMemo(
    () => options.changeset()?.files.map((file) => file.path) ?? []
  );

  // Collapsed files from an older capture read as empty; the next write
  // re-keys the stored state to the current capture.
  const collapsed = createMemo(() => {
    const current = stored();
    return new Set(
      current.changesetId === changesetId() ? current.collapsed : []
    );
  });
  const writeCollapsed = (update: (paths: string[]) => string[]) =>
    setStored((previous) => ({
      ...previous,
      changesetId: changesetId(),
      collapsed: update([...collapsed()]),
    }));

  const anyExpanded = () => paths().some((path) => !collapsed().has(path));

  const notes = () => stored().notes;

  return {
    collapsed,
    isCollapsed: (path) => collapsed().has(path),
    toggleCollapsed: (path) => writeCollapsed((paths) => toggleIn(paths, path)),
    toggleAllCollapsed: () =>
      writeCollapsed(() => (anyExpanded() ? [...paths()] : [])),
    anyExpanded,

    active,
    activate: (path) => {
      if (collapsed().has(path)) {
        writeCollapsed((paths) => paths.filter((item) => item !== path));
      }
      // Re-selecting the same file must still scroll, so clear first.
      setActive(undefined);
      setActive(path);
    },

    notes,
    queued: () => queuedNotes(notes()),
    composing,
    openNote: (anchor) => setComposing(anchor),
    cancelNote: () => setComposing(undefined),
    addNote: (anchor, text) => {
      const trimmed = text.trim();
      const current = composing();
      if (current && noteAnchorKey(current) === noteAnchorKey(anchor)) {
        setComposing(undefined);
      }
      if (trimmed === '') return;
      setStored((previous) => ({
        ...previous,
        notes: [
          ...previous.notes,
          { id: newId(), ...anchor, text: trimmed, createdAt: now() },
        ],
      }));
    },
    updateNote: (id, text) =>
      setStored((previous) => ({
        ...previous,
        notes: previous.notes.map((note) =>
          note.id === id && note.sentAt === undefined ? { ...note, text } : note
        ),
      })),
    removeNote: (id) =>
      setStored((previous) => ({
        ...previous,
        notes: previous.notes.filter((note) => note.id !== id),
      })),
    markQueuedSent: () => {
      const sent = queuedNotes(notes());
      if (sent.length === 0) return [];
      const sentAt = now();
      setStored((previous) => ({
        ...previous,
        notes: previous.notes.map((note) =>
          note.sentAt === undefined ? { ...note, sentAt } : note
        ),
      }));
      return sent.map((note) => ({ ...note, sentAt }));
    },
  };
}
