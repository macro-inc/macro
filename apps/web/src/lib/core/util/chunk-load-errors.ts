// A speculative import can fail before the app installs its reload UI. Keep one
// pending failure, not the failed module or error payload, until that owner joins.
let pending = false;
let recover: (() => void) | undefined;

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', () => {
    if (recover) recover();
    else pending = true;
  });
}

/** Install the existing failed-load recovery after its UI/transport is ready. */
export function registerChunkLoadRecovery(handler: () => void) {
  recover = handler;
  if (!pending) return;
  pending = false;
  handler();
}
