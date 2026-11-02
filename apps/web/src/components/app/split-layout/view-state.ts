import type { Entry, SplitLocation } from '@app/lib/split-router';
import {
  type Accessor,
  createComputed,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import type { EntryState } from './layoutManager';

export type RetainedViewState = {
  location: SplitLocation;
  routeState: unknown;
  entryState: EntryState | undefined;
  params?: Record<string, unknown>;
  preserveParams?: boolean;
};

/** Layout-owned, memory-only state for views that explicitly register retention. */
export function createViewState(options: {
  activeOwner: Accessor<string | undefined>;
  sessionKey?: Accessor<string | undefined>;
}) {
  type Source = {
    key: string;
    owner: string;
    order: number;
    capture: (entry: Entry) => RetainedViewState | undefined;
    entry: Accessor<Entry | undefined>;
  };
  const sources = new Set<Source>();
  const saved = new Map<
    string,
    { snapshot: RetainedViewState; order: number }
  >();
  const entryOwners = new Map<
    string,
    { generation: number; sessionKey: string | undefined }
  >();
  let generation = 0;
  let order = 0;

  function clear() {
    generation += 1;
    saved.clear();
  }

  if (options.sessionKey) {
    createComputed(on(options.sessionKey, clear, { defer: true }));
  }
  onCleanup(() => {
    clear();
    sources.clear();
    entryOwners.clear();
  });

  const authenticated = () =>
    !options.sessionKey || options.sessionKey() !== undefined;

  function observe(entry: Entry) {
    let owner = entryOwners.get(entry.id);
    if (!owner) {
      owner = { generation, sessionKey: options.sessionKey?.() };
      entryOwners.set(entry.id, owner);
    }
    return owner;
  }

  function currentEntry(entry: Entry) {
    const owner = observe(entry);
    const sessionKey = options.sessionKey?.();
    // An initial URL can arrive before authentication identifies its owner.
    if (
      options.sessionKey &&
      owner.sessionKey === undefined &&
      sessionKey !== undefined
    ) {
      owner.generation = generation;
      owner.sessionKey = sessionKey;
    }
    return owner.generation === generation;
  }

  function register(
    key: string,
    owner: string,
    entry: Source['entry'],
    capture: Source['capture']
  ) {
    const source: Source = {
      key,
      owner,
      capture,
      order: untrack(options.activeOwner) === owner ? ++order : 0,
      entry,
    };
    sources.add(source);

    return {
      /** Capture now; the router calls the returned publisher only after commit. */
      remember(entry: Entry): (() => void) | undefined {
        if (!authenticated() || !currentEntry(entry)) return;
        const capturedGeneration = generation;
        const snapshot = capture(entry);
        if (!snapshot) return;
        const capturedOrder = source.order;
        return () => {
          if (!authenticated() || capturedGeneration !== generation) return;
          const previous = saved.get(key);
          if (!previous || capturedOrder >= previous.order) {
            saved.set(key, { snapshot, order: capturedOrder });
          }
        };
      },
      dispose: () => sources.delete(source),
    };
  }

  return {
    register,
    observe,
    forget: (entryId: string) => entryOwners.delete(entryId),
    /** A live opted-in view can resume without first leaving or unmounting. */
    get(key: string): RetainedViewState | undefined {
      if (!authenticated()) return;
      let snapshot = saved.get(key)?.snapshot;
      let newest = saved.get(key)?.order ?? -1;
      for (const source of sources) {
        if (source.key !== key || source.order < newest) continue;
        const entry = source.entry();
        if (!entry || !currentEntry(entry)) continue;
        const live = source.capture(entry);
        if (!live) continue;
        snapshot = live;
        newest = source.order;
      }
      return snapshot;
    },
    activate(owner: string) {
      if (!authenticated()) return;
      for (const source of sources) {
        if (source.owner === owner) {
          source.order = ++order;
        }
      }
    },
  };
}

export type ViewState = ReturnType<typeof createViewState>;
