import type { ExternalLocation } from '../routes/types';
import {
  createList,
  hostPath,
  normalizeBase,
  readSlice,
  revertChange,
  stateForWrite,
  toMountLocation,
} from './shared';
import type { ExternalChange, HistoryAdapter } from './types';

export type BrowserHistoryOptions = {
  base?: string;
  /** Rewrites incoming mount-relative paths, such as legacy URLs. Current-format paths must come back unchanged. */
  transformPath?: (path: string) => string;
  window?: Window;
};

type Position = { index: number; state: unknown; location: ExternalLocation };

/** Owns `window.history` directly. Never mount it alongside another router. */
export function createBrowserHistory(
  options: BrowserHistoryOptions = {}
): HistoryAdapter {
  const win = options.window ?? window;
  const base = normalizeBase(options.base);
  const listeners = createList<(change: ExternalChange) => void>();

  const hasListeners = () => listeners.items().length > 0;

  const read = (): ExternalLocation => {
    const { pathname, search, hash } = win.location;
    const current = `${pathname}${search}${hash}`;
    const mounted = toMountLocation(current, base, options.transformPath);
    const location = mounted ?? { path: '/', search: '', hash: '' };
    const value = readSlice(win.history.state)?.value;

    return value ? { ...location, state: value } : location;
  };

  const href = (location: Omit<ExternalLocation, 'state'>) =>
    hostPath(base, location);

  const position = (index: number): Position => ({
    index,
    state: win.history.state,
    location: read(),
  });

  let last = position(readSlice(win.history.state)?.index ?? 0);

  const goAndWait = (delta: number) =>
    new Promise<void>((resolve) => {
      win.addEventListener('popstate', () => resolve(), { once: true });
      win.history.go(delta);
    });

  const putBack = (previous: Position) => {
    win.history.replaceState(previous.state, '', href(previous.location));
    last = previous;
  };

  const onPopState = () => {
    const landed = readSlice(win.history.state);
    const previous = last;
    last = position(landed?.index ?? previous.index + 1);

    const change: ExternalChange = {
      location: last.location,
      revert: () =>
        revertChange(landed, previous.index, {
          go: goAndWait,
          replace: () => putBack(previous),
        }),
    };

    for (const listener of listeners.items()) listener(change);
  };

  return {
    read,

    write(location, { mode }) {
      const replace = mode === 'replace';
      const index = replace ? last.index : last.index + 1;
      const url = href(location);
      const state = stateForWrite({
        index,
        location,
        replace,
        current: win.history.state,
      });

      if (replace) win.history.replaceState(state, '', url);
      else win.history.pushState(state, '', url);

      last = position(index);
    },

    subscribe(listener) {
      if (!hasListeners()) win.addEventListener('popstate', onPopState);

      const remove = listeners.add(listener);

      return () => {
        remove();
        if (hasListeners()) return;

        win.removeEventListener('popstate', onPopState);
      };
    },

    href,
  };
}
