import {
  type BeforeLeaveEventArgs,
  type Location,
  type Navigator,
  useBeforeLeave,
  useLocation,
  useNavigate,
} from '@solidjs/router';
import { createEffect, createRoot, on, untrack } from 'solid-js';
import { formatLocation, sameExternalLocation } from '../routes/codec';
import type { ExternalLocation } from '../routes/types';
import type { MaybePromise } from '../utils';
import {
  createList,
  type HistorySlice,
  hostPath,
  normalizeBase,
  readSlice,
  revertChange,
  stateForWrite,
  toMountLocation,
} from './shared';
import type { ExternalChange, HistoryAdapter, InterceptHandler } from './types';

export type SolidRouterLocationLike = Pick<
  Location,
  'pathname' | 'search' | 'hash' | 'state'
>;

export type SolidRouterNavigate = Navigator;

export type SolidBeforeLeaveEvent = Pick<
  BeforeLeaveEventArgs,
  'to' | 'defaultPrevented' | 'preventDefault' | 'retry'
>;

export type SolidRouterHistoryOptions = {
  location: SolidRouterLocationLike;
  navigate: SolidRouterNavigate;
  /** Solid Router's `useBeforeLeave`; enables `intercept`. */
  beforeLeave?: (listener: (event: SolidBeforeLeaveEvent) => void) => void;
  /** The `base` passed to the Solid Router. */
  base?: string;
  /** `HashRouter` renders `#/path`. */
  mode?: 'path' | 'hash';
  /**
   * Rewrites incoming mount-relative paths: the Router's `transformUrl`, which
   * Solid applies only when matching routes, and upgrades of legacy URLs.
   * Current-format paths must come back unchanged.
   */
  transformPath?: (path: string) => string;
  /** The host path a Back or Forward landed on; defaults to `window.location`. */
  landedPath?: () => string;
};

type Position = { index: number; location: ExternalLocation };

type BeforeLeave = NonNullable<SolidRouterHistoryOptions['beforeLeave']>;

async function settleIntercept(
  verdict: Promise<boolean>,
  event: SolidBeforeLeaveEvent,
  onAllowed?: () => void
): Promise<void> {
  try {
    if (!(await verdict)) return;

    onAllowed?.();
    event.retry(true);
  } catch (error) {
    console.error('Split router navigation guard failed', error);
  }
}

/** Where the browser is now; Solid Router asks before-leave listeners before its `location` catches up. */
function windowPath(mode: SolidRouterHistoryOptions['mode']): string {
  const { pathname, search, hash } = window.location;
  if (mode === 'hash') return hash.slice(1) || '/';

  return `${pathname}${search}${hash}`;
}

export function createSolidRouterHistory(
  options: SolidRouterHistoryOptions
): HistoryAdapter {
  const { location, navigate, beforeLeave } = options;
  const base = normalizeBase(options.base);
  const listeners = createList<(change: ExternalChange) => void>();
  let reverting: (() => void)[] = [];
  let writing = false;
  let queued: { location: ExternalLocation; pushed: boolean } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopObserving: (() => void) | undefined;

  const hasListeners = () => listeners.items().length > 0;
  const hostState = () => untrack(() => location.state);
  const ownSlice = () => readSlice(hostState());

  const toMount = (path: string) =>
    toMountLocation(path, base, options.transformPath);

  const read = (): ExternalLocation =>
    untrack(() => {
      const path = toMount(location.pathname)?.path ?? '/';
      const value = ownSlice()?.value;
      const current = { path, search: location.search, hash: location.hash };

      return value ? { ...current, state: value } : current;
    });

  let last: Position = { index: ownSlice()?.index ?? 0, location: read() };

  const navigateTo = (
    next: ExternalLocation,
    index: number,
    replace: boolean
  ) => {
    const state = stateForWrite({
      index,
      location: next,
      replace,
      current: hostState(),
    });
    // Before navigating: the write may land synchronously and must be recognized.
    last = { index, location: next };
    writing = true;

    try {
      navigate(formatLocation(next), { replace, scroll: false, state });
    } finally {
      writing = false;
    }
  };

  const dropQueued = () => {
    clearTimeout(timer);
    timer = undefined;
    queued = undefined;
  };

  const flush = () => {
    const write = queued;
    dropQueued();
    if (!write) return;

    const index = write.pushed ? last.index + 1 : last.index;
    navigateTo(write.location, index, !write.pushed);
  };

  const settleReverts = () => {
    const reverted = reverting;
    reverting = [];
    for (const resolve of reverted) resolve();
  };

  // Either way the revert lands as a location change.
  const revertTo = (previous: Position, landed: HistorySlice | undefined) =>
    new Promise<void>((resolve) => {
      reverting.push(resolve);
      revertChange(landed, previous.index, {
        go: (delta) => navigate(delta),
        replace: () => navigateTo(previous.location, previous.index, true),
      });
    });

  const reportChange = () => {
    const next = read();
    const landed = ownSlice();
    const samePosition = landed?.index === last.index;
    const ownWriteLanded =
      samePosition && sameExternalLocation(next, last.location);
    // Our own write landing must not drop a newer write queued behind it.
    if (ownWriteLanded) return;

    // Anything else supersedes writes that haven't been sent yet.
    dropQueued();

    const outsideBase = !toMount(untrack(() => location.pathname));
    if (outsideBase) return;

    const previous = last;
    last = { index: landed?.index ?? previous.index + 1, location: next };

    const change: ExternalChange = {
      location: next,
      revert: () => revertTo(previous, landed),
    };

    for (const listener of listeners.items()) listener(change);
  };

  const onLocationChange = () => {
    reportChange();
    settleReverts();
  };

  const trackedLocation = () => [
    location.pathname,
    location.search,
    location.hash,
    location.state,
  ];

  const observe = () =>
    createRoot((dispose) => {
      createEffect(on(trackedLocation, onLocationChange, { defer: true }));

      return dispose;
    });

  const stopObservingIfIdle = () => {
    if (hasListeners()) return;

    // With nobody listening, a queued write could only drag the host back in.
    dropQueued();
    stopObserving?.();
    stopObserving = undefined;
    // Unobserved, a revert's landing would never be seen.
    settleReverts();
  };

  const landedPath = options.landedPath ?? (() => windowPath(options.mode));

  /** Leaving the router's routes; a write still queued would pull the host back in. */
  const leave = (
    verdict: MaybePromise<boolean>,
    event: SolidBeforeLeaveEvent
  ) => {
    if (verdict === true) {
      dropQueued();
      return;
    }

    event.preventDefault();
    if (verdict === false) return;

    void settleIntercept(verdict, event, dropQueued);
  };

  /** Back or Forward within the router's routes is the router's to follow; out of them, guards decide. */
  const interceptTraversal = (
    handler: InterceptHandler,
    event: SolidBeforeLeaveEvent
  ) => {
    const staysInRouter = toMount(landedPath()) !== undefined;
    if (staysInRouter) return;

    leave(handler(undefined), event);
  };

  const interceptNavigation = (
    handler: InterceptHandler,
    event: SolidBeforeLeaveEvent,
    to: string
  ) => {
    const mount = toMount(to);
    if (!mount) {
      leave(handler(undefined), event);
      return;
    }

    const verdict = handler(mount);
    if (verdict === true) return;

    event.preventDefault();
    if (verdict === false) return;

    void settleIntercept(verdict, event);
  };

  const interceptLeave = (
    handler: InterceptHandler,
    event: SolidBeforeLeaveEvent
  ) => {
    const ignored = writing || event.defaultPrevented;
    if (ignored) return;

    const { to } = event;
    if (typeof to === 'number') {
      interceptTraversal(handler, event);
      return;
    }

    interceptNavigation(handler, event, to);
  };

  const listenBeforeLeave = (listen: BeforeLeave, handler: InterceptHandler) =>
    createRoot((dispose) => {
      listen((event) => interceptLeave(handler, event));

      return dispose;
    });

  return {
    read,

    write(next, { mode }) {
      const alreadyPushed = queued?.pushed ?? false;
      const pushed = alreadyPushed || mode === 'push';
      queued = { location: next, pushed };
      // A later task, not a microtask: starting Solid Router's transition while
      // a pane is mounting can skip that pane's onMount callbacks.
      timer ??= setTimeout(flush, 0);
    },

    subscribe(listener) {
      const remove = listeners.add(listener);
      stopObserving ??= observe();

      return () => {
        remove();
        stopObservingIfIdle();
      };
    },

    href(next) {
      const host = hostPath(base, next);

      return options.mode === 'hash' ? `#${host}` : host;
    },

    intercept: beforeLeave
      ? (handler) => listenBeforeLeave(beforeLeave, handler)
      : undefined,
  };
}

/** The Solid Router adapter wired to the router mounted above the caller. */
export function useSolidRouterHistory(
  options: Omit<
    SolidRouterHistoryOptions,
    'location' | 'navigate' | 'beforeLeave'
  >
): HistoryAdapter {
  return createSolidRouterHistory({
    ...options,
    location: useLocation(),
    navigate: useNavigate(),
    beforeLeave: useBeforeLeave,
  });
}
