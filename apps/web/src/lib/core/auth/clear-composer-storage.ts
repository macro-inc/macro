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
      key?.startsWith('attachment-tracker-')
    ) {
      localStorage.removeItem(key);
    }
  }
}
