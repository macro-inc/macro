/** Why this browser cannot run the worker-backed cache, if it cannot. Kept
 * apart from the worker host so the rollout gate can check it without loading
 * the host. */
export function unsupportedBrowserReason(): string | undefined {
  if (typeof SharedWorker !== 'function') {
    return 'SharedWorker is not supported by this browser';
  }
  if (typeof Worker !== 'function') {
    return 'DedicatedWorker is not supported by this browser';
  }
  if (typeof MessageChannel !== 'function') {
    return 'MessageChannel is not supported by this browser';
  }
  if (
    typeof navigator === 'undefined' ||
    !navigator.locks ||
    typeof navigator.locks.request !== 'function'
  ) {
    return 'Web Locks are not supported by this browser';
  }
  if (
    !navigator.storage ||
    typeof navigator.storage.getDirectory !== 'function'
  ) {
    return 'OPFS is not supported by this browser';
  }
  // Do not probe createSyncAccessHandle here: Chromium and Firefox expose it
  // only inside DedicatedWorker. Engine initialization reports that async
  // capability failure through the normal terminal-init path.
  return undefined;
}
