import {
  forgetUnconfirmedSendsInMemory,
  HELD_AT_PREFIX,
  UNCONFIRMED_SENDS_PREFIX,
} from '@core/agent-session/unconfirmed-sends';

export const COMPOSER_STORAGE_CLEARED = 'macro:composer-storage-cleared';

/** Remove saved composer text and attachment references on explicit logout. */
export function clearComposerStorage(): void {
  // Retire mounted autosavers before removing data; auth teardown can await I/O.
  window.dispatchEvent(new Event(COMPOSER_STORAGE_CLEARED));
  for (let index = localStorage.length - 1; index >= 0; index--) {
    const key = localStorage.key(index);
    if (
      key?.startsWith('input-value-') ||
      key?.startsWith('task-composer-submission:') ||
      key?.startsWith('task-composer-draft') ||
      key === 'routine-composer-draft' ||
      key?.startsWith('attachment-tracker-') ||
      key?.startsWith(UNCONFIRMED_SENDS_PREFIX) ||
      key?.startsWith(HELD_AT_PREFIX)
    ) {
      localStorage.removeItem(key);
    }
  }
  // After the keys are gone, so a read it prompts finds none of them.
  forgetUnconfirmedSendsInMemory();
}
