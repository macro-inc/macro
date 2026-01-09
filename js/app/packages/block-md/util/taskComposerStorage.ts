import type { PropertyApiValues } from '@core/component/Properties/types';

const STORAGE_KEY = 'task-composer-draft';
const EXPIRY_TIME_MS = 2 * 60 * 1000; // 2 minutes

export interface TaskComposerDraft {
  title: string;
  content: string;
  propertyValues: Record<string, PropertyApiValues>;
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

    return draft;
  } catch (error) {
    console.warn('Failed to load task composer draft:', error);
    clearTaskComposerDraft();
    return null;
  }
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
