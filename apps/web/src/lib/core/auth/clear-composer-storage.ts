export const COMPOSER_STORAGE_CLEARED = 'macro:composer-storage-cleared';

let generation = 0;
let clearing = false;

/**
 * Changes each time composer storage is cleared: work that will write a
 * draft later reads it first, and writes only while
 * `composerStorageWritable` says so.
 */
export function composerStorageGeneration(): number {
  return generation;
}

/**
 * Whether a draft read under `captured` may still be written back: composer
 * storage was not cleared since, and no sign-out is clearing it now.
 */
export function composerStorageWritable(captured: number): boolean {
  return !clearing && captured === generation;
}

/**
 * Ends a sign-out's clear, once the signed-out user is published or the
 * sign-out failed; does nothing when no clear is under way. An input
 * that mounted in between read the generation the clear set while the old
 * account was still shown, so the generation moves on again.
 */
export function endComposerStorageClear(): void {
  if (!clearing) return;
  clearing = false;
  generation += 1;
}

/** Remove saved composer text and attachment references on explicit logout. */
export function clearComposerStorage(): void {
  generation += 1;
  clearing = true;
  // Retire mounted autosavers before removing data; auth teardown can await I/O.
  window.dispatchEvent(new Event(COMPOSER_STORAGE_CLEARED));
  for (let index = localStorage.length - 1; index >= 0; index--) {
    const key = localStorage.key(index);
    if (
      key?.startsWith('input-value-') ||
      key?.startsWith('task-composer-submission:') ||
      key?.startsWith('task-composer-draft') ||
      key === 'routine-composer-draft' ||
      key?.startsWith('attachment-tracker-')
    ) {
      localStorage.removeItem(key);
    }
  }
}
