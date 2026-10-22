import { makePersistedState } from '@app/lib/persistence';
import type { PropertyApiValues } from '@property/types';
import type { SerializedEditorState } from 'lexical';
import { createSignal } from 'solid-js';
import { z } from 'zod';
import { taskComposerDraftSchema } from './taskComposerDraftSchema';

const storedDraftSchema = taskComposerDraftSchema.extend({
  timestamp: z.number(),
});

const STORAGE_KEY = 'task-composer-draft';

/** Recovered submissions keep their sharing choice separate from new-task defaults. */
export function createTaskComposerSharing(recoveredShare?: boolean) {
  if (recoveredShare !== undefined) return createSignal(recoveredShare);
  return makePersistedState(createSignal(true), {
    storages: {
      restore: () => {
        const stored = localStorage.getItem('task-composer-share-with-team');
        return stored === 'true'
          ? true
          : stored === 'false'
            ? false
            : undefined;
      },
      write: (value) =>
        localStorage.setItem('task-composer-share-with-team', String(value)),
    },
  });
}

/** Context drafts use their own key; the global composer retains its original key. */
export function taskComposerContextStorage(
  key: string
): TaskComposerDraftStorage {
  return { storageKey: `${STORAGE_KEY}:${key}` };
}
const EXPIRY_TIME_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Where a task composer draft is stored and how long it stays valid.
 * Defaults describe the global compose-task dialog draft; other hosts
 * (e.g. the channel input's task mode) pass their own scoped key.
 */
export type TaskComposerDraftStorage = {
  /** localStorage key. Defaults to the compose-task dialog's draft. */
  storageKey?: string;
  /** Max draft age in ms; `null` means drafts never expire. Defaults to 2 minutes. */
  expiryMs?: number | null;
};

export interface TaskComposerDraft {
  title: string;
  /** Serialized Lexical editor state (lossless — preserves images, dimensions, etc.) */
  editorState?: SerializedEditorState;
  /** Markdown text fallback (used by older drafts and for the createTask API) */
  content: string;
  propertyValues: Record<string, PropertyApiValues>;
  visiblePropertyIds?: string[];
  timestamp: number;
}

/**
 * Save task composer draft to local storage
 */
export function saveTaskComposerDraft(
  draft: Omit<TaskComposerDraft, 'timestamp'>,
  storage?: TaskComposerDraftStorage
): void {
  try {
    const draftWithTimestamp: TaskComposerDraft = {
      ...draft,
      timestamp: Date.now(),
    };
    localStorage.setItem(
      storage?.storageKey ?? STORAGE_KEY,
      JSON.stringify(draftWithTimestamp)
    );
  } catch (error) {
    console.warn('Failed to save task composer draft:', error);
  }
}

/**
 * Load task composer draft from local storage if not expired
 */
export function loadTaskComposerDraft(
  storage?: TaskComposerDraftStorage
): TaskComposerDraft | null {
  try {
    const stored = localStorage.getItem(storage?.storageKey ?? STORAGE_KEY);
    if (!stored) return null;

    const draft = storedDraftSchema.parse(JSON.parse(stored));
    const expiryMs =
      storage?.expiryMs === undefined ? EXPIRY_TIME_MS : storage.expiryMs;
    const elapsed = Date.now() - draft.timestamp;

    if (expiryMs !== null && elapsed > expiryMs) {
      // Draft expired, remove it
      clearTaskComposerDraft(storage);
      return null;
    }

    return draft;
  } catch (error) {
    console.warn('Failed to load task composer draft:', error);
    clearTaskComposerDraft(storage);
    return null;
  }
}

/**
 * Clear task composer draft from local storage
 */
export function clearTaskComposerDraft(
  storage?: TaskComposerDraftStorage
): void {
  try {
    localStorage.removeItem(storage?.storageKey ?? STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear task composer draft:', error);
  }
}

/**
 * Update timestamp of existing draft (used when closing composer)
 */
export function updateDraftTimestamp(storage?: TaskComposerDraftStorage): void {
  try {
    const key = storage?.storageKey ?? STORAGE_KEY;
    const stored = localStorage.getItem(key);
    if (!stored) return;

    const draft: TaskComposerDraft = JSON.parse(stored);
    draft.timestamp = Date.now();
    localStorage.setItem(key, JSON.stringify(draft));
  } catch (error) {
    console.warn('Failed to update draft timestamp:', error);
  }
}

/**
 * Check if there's a valid draft available
 */
export function hasValidDraft(): boolean {
  return loadTaskComposerDraft() !== null;
}
