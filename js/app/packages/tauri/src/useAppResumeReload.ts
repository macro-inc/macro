import { onCleanup, onMount } from 'solid-js';

const EXTENDED_BACKGROUND_THRESHOLD_MS = 1 * 5 * 1000;

/**
 * Monitors app visibility and triggers a callback when returning from an extended background period.
 *
 * @param onResumeCallback - Function to call when app resumes after extended background.
 */
export function useAppResumeReload(onResumeCallback: () => Promise<void>) {
  let lastActiveTime = Date.now();

  onMount(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastActiveTime;

        if (elapsed > EXTENDED_BACKGROUND_THRESHOLD_MS) {
          await onResumeCallback();
        }
      } else {
        lastActiveTime = Date.now();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    onCleanup(() => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    });
  });
}
