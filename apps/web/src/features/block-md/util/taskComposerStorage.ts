import type { PropertyApiValues } from '@property/types';
import type { SerializedEditorState } from 'lexical';
import { createSignal } from 'solid-js';

const STORAGE_KEY = 'task-composer-draft';
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
  timestamp: number;
}

const [trackedTaskComposerDraft, setTrackedTaskComposerDraft] =
  createSignal<TaskComposerDraft | null>(null);
let trackedDraftExpiryTimer: ReturnType<typeof setTimeout> | undefined;
let activeTaskDraftCleanup: (() => void) | undefined;

/** The current global task-composer draft, when one has been saved. */
export { trackedTaskComposerDraft };

const usesGlobalTaskDraftStorage = (storage?: TaskComposerDraftStorage) =>
  storage?.storageKey === undefined || storage.storageKey === STORAGE_KEY;

const scheduleTrackedDraftExpiry = (
  timestamp: number,
  storage?: TaskComposerDraftStorage
) => {
  if (!usesGlobalTaskDraftStorage(storage)) return;
  if (trackedDraftExpiryTimer) clearTimeout(trackedDraftExpiryTimer);
  const expiryMs =
    storage?.expiryMs === undefined ? EXPIRY_TIME_MS : storage.expiryMs;
  if (expiryMs === null) {
    trackedDraftExpiryTimer = undefined;
    return;
  }
  const expire = () => {
    if (activeTaskDraftCleanup) {
      trackedDraftExpiryTimer = setTimeout(expire, expiryMs);
      return;
    }
    clearTaskComposerDraft(storage);
  };
  trackedDraftExpiryTimer = setTimeout(
    expire,
    Math.max(timestamp + expiryMs - Date.now() + 1, 1)
  );
};

/** Registers cleanup owned by the currently mounted global task composer. */
export function registerTaskDraftCleanup(handler: () => void) {
  activeTaskDraftCleanup = handler;
  return () => {
    if (activeTaskDraftCleanup === handler) activeTaskDraftCleanup = undefined;
  };
}

/** Clears through the mounted composer when it owns the global task draft. */
export function cleanupTaskDraftThroughComposer() {
  if (!activeTaskDraftCleanup) return false;
  activeTaskDraftCleanup();
  return true;
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
    if (usesGlobalTaskDraftStorage(storage)) {
      setTrackedTaskComposerDraft(draftWithTimestamp);
      scheduleTrackedDraftExpiry(draftWithTimestamp.timestamp, storage);
    }
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

    const draft: TaskComposerDraft = JSON.parse(stored);
    const expiryMs =
      storage?.expiryMs === undefined ? EXPIRY_TIME_MS : storage.expiryMs;
    const elapsed = Date.now() - draft.timestamp;

    if (expiryMs !== null && elapsed > expiryMs) {
      // Draft expired, remove it
      clearTaskComposerDraft(storage);
      return null;
    }

    draft.propertyValues = rehydratePropertyValues(draft.propertyValues);
    if (usesGlobalTaskDraftStorage(storage)) {
      setTrackedTaskComposerDraft(draft);
      scheduleTrackedDraftExpiry(draft.timestamp, storage);
    }
    return draft;
  } catch (error) {
    console.warn('Failed to load task composer draft:', error);
    clearTaskComposerDraft(storage);
    return null;
  }
}

// JSON.stringify serializes Date as an ISO string, and JSON.parse won't turn
// it back into a Date. propertyApiValuesToNormalized requires `value instanceof
// Date`, so without this step DATE properties round-trip as EMPTY.
function rehydratePropertyValues(
  values: Record<string, PropertyApiValues>
): Record<string, PropertyApiValues> {
  const result: Record<string, PropertyApiValues> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value.valueType === 'DATE') {
      const raw = (value as { value: unknown }).value;
      result[key] = {
        valueType: 'DATE',
        value: typeof raw === 'string' ? new Date(raw) : (raw as Date | null),
      };
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Clear task composer draft from local storage
 */
export function clearTaskComposerDraft(
  storage?: TaskComposerDraftStorage
): void {
  try {
    localStorage.removeItem(storage?.storageKey ?? STORAGE_KEY);
    if (usesGlobalTaskDraftStorage(storage)) {
      if (trackedDraftExpiryTimer) clearTimeout(trackedDraftExpiryTimer);
      trackedDraftExpiryTimer = undefined;
      setTrackedTaskComposerDraft(null);
    }
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
    if (usesGlobalTaskDraftStorage(storage)) {
      setTrackedTaskComposerDraft(draft);
      scheduleTrackedDraftExpiry(draft.timestamp, storage);
    }
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
