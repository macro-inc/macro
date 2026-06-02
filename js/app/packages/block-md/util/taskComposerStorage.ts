import type { PropertyApiValues } from '@property/types';
import type { TaskSimilarityResult } from '@service-storage/client';
import type { SerializedEditorState } from 'lexical';

const STORAGE_KEY = 'task-composer-draft';
const EXPIRY_TIME_MS = 2 * 60 * 1000; // 2 minutes

export interface TaskComposerDraft {
  title: string;
  /** Serialized Lexical editor state (lossless — preserves images, dimensions, etc.) */
  editorState?: SerializedEditorState;
  /** Markdown text fallback (used by older drafts and for the createTask API) */
  content: string;
  propertyValues: Record<string, PropertyApiValues>;
  /** Possible-duplicate tasks last surfaced for this draft, persisted so they
   * reappear instantly when the draft is restored. */
  similarTasks?: TaskSimilarityResult[];
  timestamp: number;
}

/**
 * Save task composer draft to local storage
 */
export function saveTaskComposerDraft(
  draft: Omit<TaskComposerDraft, 'timestamp'>
): void {
  try {
    const draftWithTimestamp: TaskComposerDraft = {
      ...draft,
      timestamp: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draftWithTimestamp));
  } catch (error) {
    console.warn('Failed to save task composer draft:', error);
  }
}

/**
 * Load task composer draft from local storage if not expired
 */
export function loadTaskComposerDraft(): TaskComposerDraft | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const draft: TaskComposerDraft = JSON.parse(stored);
    const now = Date.now();
    const elapsed = now - draft.timestamp;

    if (elapsed > EXPIRY_TIME_MS) {
      // Draft expired, remove it
      clearTaskComposerDraft();
      return null;
    }

    draft.propertyValues = rehydratePropertyValues(draft.propertyValues);
    return draft;
  } catch (error) {
    console.warn('Failed to load task composer draft:', error);
    clearTaskComposerDraft();
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
export function clearTaskComposerDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear task composer draft:', error);
  }
}

/**
 * Update timestamp of existing draft (used when closing composer)
 */
export function updateDraftTimestamp(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;

    const draft: TaskComposerDraft = JSON.parse(stored);
    draft.timestamp = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
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
