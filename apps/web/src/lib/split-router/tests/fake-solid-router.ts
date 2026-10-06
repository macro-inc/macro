import { batch, createSignal } from 'solid-js';
import { vi } from 'vitest';
import type {
  SolidBeforeLeaveEvent,
  SolidRouterLocationLike,
  SolidRouterNavigate,
} from '../history/solid-router';
import { parseLocation } from '../routes/codec';

type HistoryEntry = { path: string; state: unknown };

/**
 * Stands in for `@solidjs/router` under a `/app` base: history entries,
 * reactive location, `navigate` and `useBeforeLeave`. Unlike Solid it applies
 * path navigations synchronously, which is the harder case for echo handling;
 * `navigate(delta)` lands in a later microtask, like `history.go`.
 */
export function createFakeSolidRouter(
  initial: string,
  /** Host paths after the current entry, as if the user had gone back. */
  ahead: readonly string[] = []
) {
  const first = parseLocation(initial);
  const [pathname, setPathname] = createSignal(first.path);
  const [search, setSearch] = createSignal(first.search);
  const [hash, setHash] = createSignal(first.hash);
  const [state, setState] = createSignal<unknown>(undefined);
  const entries: HistoryEntry[] = [initial, ...ahead].map((path) => ({
    path,
    state: undefined,
  }));
  let index = 0;
  const calls: [string | number, unknown?][] = [];

  const show = (value: string, nextState: unknown) => {
    const next = parseLocation(value);

    batch(() => {
      setPathname(next.path);
      setSearch(next.search);
      setHash(next.hash);
      setState(() => nextState);
    });
  };

  const traverse = (delta: number) => {
    index += delta;
    const entry = entries[index]!;

    show(entry.path, entry.state);
  };

  const record = (entry: HistoryEntry, replace: boolean | undefined) => {
    if (replace) {
      entries[index] = entry;
      return;
    }

    entries.splice(index + 1);
    entries.push(entry);
    index += 1;
  };

  const navigate = ((
    to: string | number,
    options?: { replace?: boolean; state?: unknown }
  ) => {
    calls.push([to, options]);

    if (typeof to === 'number') {
      queueMicrotask(() => traverse(to));
      return;
    }

    // Solid resolves absolute paths against the Router `base`.
    const entry = { path: `/app${to}`, state: options?.state };
    record(entry, options?.replace);
    show(entry.path, entry.state);
  }) as SolidRouterNavigate;

  const leaveListeners: ((event: SolidBeforeLeaveEvent) => void)[] = [];

  const leave = (to: string | number) => {
    const event = {
      to,
      defaultPrevented: false,
      preventDefault: vi.fn(() => {
        event.defaultPrevented = true;
      }),
      retry: vi.fn(),
    };

    for (const listener of leaveListeners) listener(event);

    return event;
  };

  /** A browser Back or Forward: the URL moves, then before-leave listeners may send it back. */
  const pop = (delta: number) => {
    index += delta;
    const event = leave(delta);

    if (event.defaultPrevented) {
      index -= delta;
      return event;
    }

    const entry = entries[index]!;
    show(entry.path, entry.state);

    return event;
  };

  const location: SolidRouterLocationLike = {
    get pathname() {
      return pathname();
    },
    get search() {
      return search();
    },
    get hash() {
      return hash();
    },
    get state() {
      return state() as SolidRouterLocationLike['state'];
    },
  };

  return {
    location,
    navigate,
    calls,
    show,
    traverse,
    leave,
    pop,
    landed: () => entries[index]!.path,
    entries: () => entries,

    beforeLeave: (listener: (event: SolidBeforeLeaveEvent) => void) => {
      leaveListeners.push(listener);
    },
  };
}
