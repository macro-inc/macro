/**
 * Coalesces dependency-driven query rereads while this page is hidden. Initial
 * queries, explicit refetches, writes, and worker recovery never enter this
 * queue. Its visibility listener exists only while there is deferred work;
 * teardown must forget an operation before its key can be reused.
 */
export function createDeferredQueryRereads(
  run: (key: number, registrationOnly: boolean) => void
) {
  const page = typeof document === 'undefined' ? undefined : document;
  const pending = new Map<number, boolean>();
  let listening = false;

  const stopListening = () => {
    if (!listening) return;
    page?.removeEventListener('visibilitychange', flush);
    listening = false;
  };

  function request(key: number, registrationOnly = false): void {
    // An ordinary invalidation must not be weakened by a later recovery-only
    // registration request, which is forbidden from falling back to the API.
    const onlyRegister = (pending.get(key) ?? true) && registrationOnly;
    pending.delete(key);
    if (page?.visibilityState === 'hidden') {
      pending.set(key, onlyRegister);
      if (!listening) {
        page.addEventListener('visibilitychange', flush);
        listening = true;
      }
      return;
    }
    if (pending.size === 0) stopListening();
    run(key, onlyRegister);
  }

  function flush(): void {
    if (page?.visibilityState === 'hidden') return;
    const entries = [...pending];
    pending.clear();
    stopListening();
    // Use request again in case the page hides during a catch-up callback.
    for (const [key, registrationOnly] of entries) {
      request(key, registrationOnly);
    }
  }

  return {
    request,
    forget(key: number) {
      pending.delete(key);
      if (pending.size === 0) stopListening();
    },
  };
}
