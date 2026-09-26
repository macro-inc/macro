const listeners = new Set<(threadIds: readonly string[]) => void>();

export function registerEmailPreparationHints(
  listener: (threadIds: readonly string[]) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** At most one hydration page; never return body strings into page state. */
export function offerEmailPreparationHints(threadIds: readonly string[]): void {
  const bounded = threadIds.slice(0, 5);
  for (const listener of listeners) listener(bounded);
}
