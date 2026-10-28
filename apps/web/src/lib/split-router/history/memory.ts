import { formatLocation, parseLocation } from '../routes/codec';
import type { ExternalLocation, WriteMode } from '../routes/types';
import { createList } from './shared';
import type { ExternalChange, HistoryAdapter, InterceptHandler } from './types';

export type MemoryHistory = HistoryAdapter & {
  intercept(handler: InterceptHandler): () => void;
  entries(): readonly ExternalLocation[];
  index(): number;
  go(delta: number): void;
  back(): void;
  forward(): void;
  /** Another part of the app navigating; interceptors run first. */
  navigate(to: string, options?: { replace?: boolean }): Promise<boolean>;
};

export function createMemoryHistory(
  initial: string | ExternalLocation = '/'
): MemoryHistory {
  const first =
    typeof initial === 'string' ? parseLocation(initial) : { ...initial };
  let entries: ExternalLocation[] = [first];
  let index = 0;
  const listeners = createList<(change: ExternalChange) => void>();
  const interceptors = createList<InterceptHandler>();

  const apply = (location: ExternalLocation, mode: WriteMode) => {
    if (mode === 'replace') {
      entries = entries.with(index, location);
      return;
    }

    entries = [...entries.slice(0, index + 1), location];
    index += 1;
  };

  const emit = (revert: () => void) => {
    const change: ExternalChange = { location: entries[index]!, revert };
    for (const listener of listeners.items()) listener(change);
  };

  const go = (delta: number) => {
    const lastIndex = entries.length - 1;
    const target = Math.max(0, Math.min(lastIndex, index + delta));
    if (target === index) return;

    const previous = index;
    index = target;
    emit(() => {
      index = previous;
    });
  };

  return {
    read: () => entries[index]!,
    write: (location, { mode }) => apply(location, mode),
    subscribe: listeners.add,
    href: (location) => formatLocation(location),
    intercept: interceptors.add,

    entries: () => entries,
    index: () => index,
    go,
    back: () => go(-1),
    forward: () => go(1),

    async navigate(to, navigateOptions = {}) {
      const location = parseLocation(to);

      for (const handler of interceptors.items()) {
        const allowed = await handler(location);
        if (!allowed) return false;
      }

      const previous = entries[index]!;
      const mode: WriteMode = navigateOptions.replace ? 'replace' : 'push';
      apply(location, mode);
      // Like a browser, a pushed entry can't be removed; revert overwrites it.
      emit(() => {
        entries = entries.with(index, previous);
      });

      return true;
    },
  };
}
