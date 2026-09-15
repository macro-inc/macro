/**
 * The reviewer's progress through a changeset: files marked viewed, diffs
 * collapsed, the file the tree last pointed at, and the notes queued for the
 * agent.
 *
 * Viewed and collapsed marks belong to one capture: a new changeset starts
 * them over. Notes outlive captures, since they are the reviewer's words,
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
  viewed: Accessor<ReadonlySet<string>>;
  isViewed: (path: string) => boolean;
  toggleViewed: (path: string) => void;
  /** Mark every file viewed, or clear every mark when all are already set. */
  toggleAllViewed: () => void;
  allViewed: Accessor<boolean>;
  progress: Accessor<{ viewed: number; total: number }>;

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
  removeNote: (id: string) => void;
  /** Stamp every queued note as sent, returning what was sent. */
  markQueuedSent: () => ReviewNote[];
};

type StoredReview = {
  /** The capture `viewed` and `collapsed` were made against. */
  changesetId: string | undefined;
  viewed: string[];
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
    viewed: strings(stored.viewed),
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
      viewed: [],
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

  // Marks made against an older capture read as empty; the next write
  // re-keys the stored state to the current capture.
  const marks = createMemo(() => {
    const current = stored();
    const matches = current.changesetId === changesetId();
    return {
      viewed: new Set(matches ? current.viewed : []),
      collapsed: new Set(matches ? current.collapsed : []),
    };
  });
  const writeMarks = (
    update: (marks: { viewed: string[]; collapsed: string[] }) => {
      viewed: string[];
      collapsed: string[];
    }
  ) =>
    setStored((previous) => {
      const current = marks();
      const next = update({
        viewed: [...current.viewed],
        collapsed: [...current.collapsed],
      });
      return { ...previous, changesetId: changesetId(), ...next };
    });

  const viewed = () => marks().viewed;
  const collapsed = () => marks().collapsed;
  const allViewed = () => {
    const all = paths();
    return all.length > 0 && all.every((path) => viewed().has(path));
  };
  const anyExpanded = () => paths().some((path) => !collapsed().has(path));

  const notes = () => stored().notes;

  return {
    viewed,
    isViewed: (path) => viewed().has(path),
    toggleViewed: (path) =>
      writeMarks(({ viewed, collapsed }) => {
        const nowViewed = !viewed.includes(path);
        return {
          viewed: toggleIn(viewed, path),
          // Viewing a file folds it away; un-viewing brings it back.
          collapsed: nowViewed
            ? collapsed.includes(path)
              ? collapsed
              : [...collapsed, path]
            : collapsed.filter((item) => item !== path),
        };
      }),
    toggleAllViewed: () =>
      writeMarks(() =>
        allViewed()
          ? { viewed: [], collapsed: [] }
          : { viewed: [...paths()], collapsed: [...paths()] }
      ),
    allViewed,
    progress: () => ({
      viewed: paths().filter((path) => viewed().has(path)).length,
      total: paths().length,
    }),

    collapsed,
    isCollapsed: (path) => collapsed().has(path),
    toggleCollapsed: (path) =>
      writeMarks(({ viewed, collapsed }) => ({
        viewed,
        collapsed: toggleIn(collapsed, path),
      })),
    toggleAllCollapsed: () =>
      writeMarks(({ viewed }) => ({
        viewed,
        collapsed: anyExpanded() ? [...paths()] : [],
      })),
    anyExpanded,

    active,
    activate: (path) => {
      if (collapsed().has(path)) {
        writeMarks(({ viewed, collapsed }) => ({
          viewed,
          collapsed: collapsed.filter((item) => item !== path),
        }));
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
