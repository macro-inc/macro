import type { ScheduleDraft } from '../component/types';

const STORAGE_KEY = 'automation-composer-draft';
const EXPIRY_TIME_MS = 3 * 60 * 1000;

interface StoredDraft {
  draft: ScheduleDraft;
  timestamp: number;
}

export function saveAutomationComposerDraft(draft: ScheduleDraft): void {
  try {
    const payload: StoredDraft = { draft, timestamp: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to save automation composer draft:', error);
  }
}

export function loadAutomationComposerDraft(): ScheduleDraft | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const payload: StoredDraft = JSON.parse(stored);
    if (Date.now() - payload.timestamp > EXPIRY_TIME_MS) {
      clearAutomationComposerDraft();
      return null;
    }
    return payload.draft;
  } catch (error) {
    console.warn('Failed to load automation composer draft:', error);
    clearAutomationComposerDraft();
    return null;
  }
}

export function clearAutomationComposerDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear automation composer draft:', error);
  }
}
