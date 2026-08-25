import type { EventEditorInitialValues } from '@app/features/calendar/components/composer/event-form-model';

/**
 * A channel input's persisted event-composer draft. Like the channel task
 * drafts (and unlike the compose-task dialog's short expiry window), event
 * drafts are kept until sent; the timestamp records the last edit.
 */
type StoredEventComposerDraft = {
  values: EventEditorInitialValues;
  timestamp: number;
};

/** Load an event composer draft's form values from local storage. */
export function loadEventComposerDraft(
  storageKey: string
): EventEditorInitialValues | null {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return null;
    const draft: StoredEventComposerDraft = JSON.parse(stored);
    if (typeof draft !== 'object' || draft === null || !draft.values) {
      return null;
    }
    return draft.values;
  } catch (error) {
    console.warn('Failed to load event composer draft:', error);
    clearEventComposerDraft(storageKey);
    return null;
  }
}

/** Save an event composer draft to local storage. */
export function saveEventComposerDraft(
  values: EventEditorInitialValues,
  storageKey: string
): void {
  try {
    const draft: StoredEventComposerDraft = { values, timestamp: Date.now() };
    localStorage.setItem(storageKey, JSON.stringify(draft));
  } catch (error) {
    console.warn('Failed to save event composer draft:', error);
  }
}

/** Clear an event composer draft from local storage. */
export function clearEventComposerDraft(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch (error) {
    console.warn('Failed to clear event composer draft:', error);
  }
}
