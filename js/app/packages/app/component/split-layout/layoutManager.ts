import type { BlockName } from '@core/block';
import { ResizeZoneCtx } from '@core/component/Resize/types';
import type {
  BlockInstanceHandle,
  BlockOrchestrator,
} from '@core/orchestrator';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSXElement,
} from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import { resolveComponent } from './componentRegistry';
import { createHistory, type History } from './history';

const ENABLE_DEFAULT_ALWAYS_IN_HISTORY = true;

export type SplitId = string & { readonly SplitId: unique symbol };
type SplitKey = `${BlockName | 'component'}:${string}`;

export type SplitContent =
  | { type: BlockName; id: string; params?: Record<string, string> }
  | { type: 'component'; id: string; params?: Record<string, string> };

function sameContent(a: SplitContent, b: SplitContent): boolean {
  return a.type === b.type && a.id === b.id;
}

function keyOfSplitContent(s: SplitContent): SplitKey {
  return `${s.type}:${s.id}`;
}

const brandSplitId = (s: string) => s as SplitId;

type ElementFn = () => JSXElement;

type BlockMount = {
  kind: 'block';
  type: string;
  id: string;
  handle: BlockInstanceHandle;
  element: ElementFn;
};

type ComponentMount = {
  kind: 'component';
  name: string;
  element: ElementFn;
};

export type SplitMount = BlockMount | ComponentMount;

export type SplitState = {
  id: SplitId;
  history: History<SplitContent>;
  content: SplitContent; // mirror of current history entry
  mount: SplitMount; // contains pinned element
};

function keyOfSplitState(s: SplitState): SplitKey {
  return `${s.content.type}:${s.content.id}`;
}

export type UrlCapabilities = {
  getUrlSegments: () => string[];
  getUrl: () => string;
};

export enum SplitEvent {
  Insert,
  Remove,
  ContentChange,
  ReturnFocus,
}

export type SplitEventPayload = {
  [SplitEvent.Insert]: {
    activate?: boolean;
    initial?: SplitContent;
    splitId: SplitId;
  };
  [SplitEvent.Remove]: {
    splitId: SplitId;
    splitIndex: number;
  };
  [SplitEvent.ContentChange]: {
    splitId: SplitId;
    splitIndex: number;
    newContent: SplitContent;
    previousContent: SplitContent;
  };
  [SplitEvent.ReturnFocus]: void;
};

export type SplitEventWithType =
  | ({ type: SplitEvent.Insert } & SplitEventPayload[SplitEvent.Insert])
  | ({ type: SplitEvent.Remove } & SplitEventPayload[SplitEvent.Remove])
  | ({
      type: SplitEvent.ContentChange;
    } & SplitEventPayload[SplitEvent.ContentChange])
  | ({
      type: SplitEvent.ReturnFocus;
    } & SplitEventPayload[SplitEvent.ReturnFocus]);

export type SplitManager = {
  readonly splits: Accessor<ReadonlyArray<SplitState>>;
  readonly activeSplitId: Accessor<SplitId | undefined>;
  readonly lastActiveSplitId: Accessor<SplitId | undefined>;
  readonly events: Accessor<SplitEventWithType>;
  readonly resizeContext: Accessor<ResizeZoneCtx | undefined>;

  // methods
  /** Get a split by its split id */
  getSplit: (id: SplitId) => SplitHandle | undefined;

  /** Remove a split by its split id */
  removeSplit: (id: SplitId) => void;

  /** Create a new split with the provided initial content and activate it */
  createNewSplit: (initial?: SplitContent, activate?: boolean) => SplitHandle;

  /** Set a split as active by its split id  */
  activateSplit: (id: SplitId) => void;

  spotlightSplit: (id: SplitId) => void;

  unSpotlightSplit: () => void;

  toggleSpotlightSplit: (id: SplitId) => void;

  /**
   * Reconcile the splits with the provided list of splits.
   * Useful for when the url changes.
   *
   * All [SplitContent] of type `component` will be fully re-created.
   * All [SplitContent] of type `block` will be preserved, and not re-mounted.
   *
   * @param splits The new list of splits
   */
  reconcile: (splits: SplitContent[]) => void;

  /** Check if a split exists by its split id */
  hasSplit: (type: BlockName | 'component', id: string) => boolean;

  /** Get a potential split id by its content type and id */
  getSplitByContent: (
    type: BlockName | 'component',
    id: string
  ) => SplitHandle | undefined;

  /** Get a reactive string that is the display name of the active split. */
  tabTitle: () => string | undefined;

  /** A function to return focus to the most recent split. */
  returnFocus: () => void;

  /** Set the layout resize context from the component tree. */
  setResizeContext: (cts: ResizeZoneCtx) => void;
} & UrlCapabilities;

export type SplitHandle = {
  unregisterContentChangeListener: (
    cb: (payload: SplitEventPayload[SplitEvent.ContentChange]) => void
  ) => void;
  registerContentChangeListener: (
    cb: (payload: SplitEventPayload[SplitEvent.ContentChange]) => void
  ) => void;
  replace: (next: SplitContent, mergeHistory?: boolean) => void;
  removeFromHistory: (predicate: (content: SplitContent) => boolean) => void;
  toggleSpotlight: (force?: boolean) => void;
  setDisplayName: (name: string) => void;
  canGoForward: () => boolean;
  content: () => SplitContent;
  isSpotLight: () => boolean;
  displayName: () => string;
  canGoBack: () => boolean;
  isActive: () => boolean;
  isFirst: () => boolean;
  goForward: () => void;
  isLast: () => boolean;
  activate: () => void;
  goBack: () => void;
  close: () => void;
  reset: () => void;
  id: SplitId;
} & UrlCapabilities;

function newSplitId(): SplitId {
  return brandSplitId(
    `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  );
}

function createPinnedMount(
  orchestrator: BlockOrchestrator,
  content: SplitContent
): SplitMount {
  if (content.type === 'component') {
    const element = resolveComponent(content.id, content.params);
    return { kind: 'component', name: content.id, element };
  }

  const handle = orchestrator.createBlockInstance(content.type, content.id);

  return {
    kind: 'block',
    type: content.type,
    id: content.id,
    handle,
    element: handle.element,
  };
}

function sameIdentity(a: SplitContent, b: SplitContent): boolean {
  if (a.type !== b.type) return false;
  return a.id === b.id;
}

function sameNonComponentIdentity(a: SplitContent, b: SplitContent): boolean {
  if (a.type === 'component' || b.type === 'component') return false;
  if (a.type !== b.type) return false;
  return a.id === b.id;
}

function isDuplicateSplit(
  splits: SplitState[],
  content: SplitContent
): boolean {
  return splits.some((split) =>
    sameNonComponentIdentity(split.content, content)
  );
}

export function createSplitLayout(
  orchestrator: BlockOrchestrator,
  initial: SplitContent[],
  defaultSplitContent?: SplitContent
): SplitManager {
  const [state, setState] = createStore<{
    splits: SplitState[];
    activeSplitId: SplitId | undefined;
    lastActiveSplitId: SplitId | undefined;
    spotlightId: SplitId | undefined;
    events: SplitEventWithType[];
  }>({
    splits: [],
    activeSplitId: undefined,
    lastActiveSplitId: undefined,
    spotlightId: undefined,
    events: [],
  });

  const [resizeContext, setResizeContext] = createSignal<ResizeZoneCtx>();

  const [splitNamesById, setSplitNamesById] = createStore<{
    [id: SplitId]: string;
  }>({});

  const contentChangeListeners = new Map<
    SplitId,
    Set<(payload: SplitEventPayload[SplitEvent.ContentChange]) => void>
  >();

  const DEFAULT_SPLIT_CONTENT = defaultSplitContent ?? {
    type: 'component',
    id: 'unified-list',
  };

  function dispatchEvent(
    type: SplitEvent,
    payload: SplitEventPayload[SplitEvent]
  ) {
    setState('events', (prev) => [
      ...prev,
      { type, ...payload } as SplitEventWithType,
    ]);
  }

  function buildSplit(
    initialContent: SplitContent,
    isDefault?: boolean
  ): SplitState {
    const id = newSplitId();
    const history = createHistory<SplitContent>();

    // If enabled, we always want to be able to go back to the default split
    if (!isDefault && ENABLE_DEFAULT_ALWAYS_IN_HISTORY) {
      history.push(DEFAULT_SPLIT_CONTENT);
    }

    history.push(initialContent);

    const mount = createPinnedMount(orchestrator, initialContent);

    return {
      id,
      history,
      content: initialContent,
      mount,
    };
  }

  function reattach(split: SplitState, next: SplitContent) {
    const otherSplits = state.splits.filter((s) => s.id !== split.id);
    if (isDuplicateSplit(otherSplits, next)) return;

    const splitIndex = state.splits.findIndex((s) => s.id === split.id);
    if (splitIndex >= 0 && !sameIdentity(split.content, next)) {
      const payload: SplitEventPayload[SplitEvent.ContentChange] = {
        splitId: split.id,
        splitIndex,
        newContent: next,
        previousContent: split.content,
      };

      dispatchEvent(SplitEvent.ContentChange, payload);

      const listeners = contentChangeListeners.get(split.id);
      if (listeners) {
        listeners.forEach((listener) => listener(payload));
      }
    }

    if (sameIdentity(split.content, next))
      return setState('splits', (s) => {
        const i = s.findIndex((x) => x.id === split.id);
        if (i < 0) return s;
        const target = { ...s[i], content: next };
        return s.with(i, target);
      });

    const newMount = createPinnedMount(orchestrator, next);

    setState('splits', (s) => {
      const i = s.findIndex((x) => x.id === split.id);
      if (i < 0) return s;
      const target = { ...s[i], content: next, mount: newMount };
      return s.with(i, target);
    });
  }

  function back(id: SplitId) {
    const i = state.splits.findIndex((s) => s.id === id);
    if (i < 0) return console.error(`Split with id ${id} not found`);

    const split = state.splits[i];
    if (!split.history.canGoBack()) return;

    const prev = split.history.back();
    if (!prev) return;

    reattach(split, prev);
  }

  function forward(id: SplitId) {
    const i = state.splits.findIndex((s) => s.id === id);
    if (i < 0) return console.error(`Split with id ${id} not found`);

    const split = state.splits[i];
    if (!split.history.canGoForward()) return;

    const next = split.history.forward();
    if (!next) return;

    reattach(split, next);
  }

  function removeFromHistory(
    id: SplitId,
    predicate: (content: SplitContent) => boolean
  ) {
    const i = state.splits.findIndex((s) => s.id === id);
    if (i < 0) return console.error(`Split with id ${id} not found`);

    const split = state.splits[i];
    const next = split.history.remove(predicate);
    if (!next) return;

    reattach(split, next);
  }

  /**
   * Replace the content of a split with the provided content. If mergeHistory is true, the current history index will be replaced with the new content.
   */
  function replace(id: SplitId, next: SplitContent, mergeHistory?: boolean) {
    const i = state.splits.findIndex((s) => s.id === id);
    if (i < 0) return console.error(`Split with id ${id} not found`);

    setSplitNamesById(
      produce((map) => {
        delete map[id];
        return map;
      })
    );

    const split = state.splits[i];
    if (mergeHistory) {
      split.history.merge(next);
    } else {
      split.history.push(next);
    }

    reattach(split, next);
  }

  function reset(id: SplitId) {
    const i = state.splits.findIndex((s) => s.id === id);
    if (i < 0) return console.error(`Split with id ${id} not found`);

    const split = state.splits[i];
    split.history = createHistory<SplitContent>();
    reattach(split, DEFAULT_SPLIT_CONTENT);
  }

  const getUrlSegments = () => {
    return state.splits
      .flatMap((s) => [s.content.type, s.content.id])
      .map(String);
  };

  const getUrl = () => {
    return (
      state.splits.map((s) => s.content.type).join('/') +
      '/' +
      state.splits.map((s) => s.content.id).join('/')
    );
  };

  function activateSplit(id: SplitId) {
    let current = state.activeSplitId;
    setState('lastActiveSplitId', current);
    if (state.spotlightId && state.spotlightId !== id) {
      setState('spotlightId', undefined);
    }
    setState('activeSplitId', id);
  }

  function spotlightSplit(id: SplitId) {
    if (state.splits.length <= 1) {
      return;
    }
    const split = state.splits.find((s) => s.id === id);
    if (!split) {
      console.error(`Split with id ${id} not found`);
      return;
    }
    setState('spotlightId', id);
    activateSplit(id);
  }
  function unSpotlightSplit() {
    setState('spotlightId', undefined);
  }

  function toggleSpotlightSplit(id: SplitId, force?: boolean) {
    if (force !== undefined) {
      if (force === true) {
        spotlightSplit(id);
      } else {
        if (state.spotlightId === id) {
          unSpotlightSplit();
        }
      }
      return;
    }
    if (state.spotlightId === id) {
      unSpotlightSplit();
    } else {
      spotlightSplit(id);
    }
  }

  const getSplit = (id: SplitId): SplitHandle | undefined => {
    const s = () => state.splits.find((x) => x.id === id);
    const currentSplit = s();
    if (!currentSplit) return;
    const content = () => s()!.content;

    return {
      id: currentSplit.id,
      content,
      activate: () => activateSplit(currentSplit.id),
      canGoBack: () => currentSplit.history.canGoBack(),
      canGoForward: () => currentSplit.history.canGoForward(),
      goBack: () => back(currentSplit.id),
      reset: () => reset(currentSplit.id),
      goForward: () => forward(currentSplit.id),
      replace: (next, mergeHistory = false) =>
        replace(currentSplit.id, next, mergeHistory),
      removeFromHistory: (predicate: (content: SplitContent) => boolean) => {
        removeFromHistory(currentSplit.id, predicate);
      },
      close: () => {
        // If there's only one split and it's the default split, then no-op
        if (state.splits.length <= 1) {
          // If it's not the default split, replace it with the default
          if (!sameContent(content(), DEFAULT_SPLIT_CONTENT))
            replace(currentSplit.id, DEFAULT_SPLIT_CONTENT);

          return;
        }

        removeSplit(currentSplit.id);
      },
      getUrlSegments: () => [content().type, content().id].map(String),
      getUrl: () => content().type + '/' + content().id,
      isFirst: () => state.splits.at(0)?.id === id,
      isLast: () => state.splits.at(-1)?.id === id,
      isActive: () => currentSplit.id === state.activeSplitId,
      isSpotLight: () => state.spotlightId === currentSplit.id,
      toggleSpotlight: (force?: boolean) => {
        toggleSpotlightSplit(currentSplit.id, force);
      },
      displayName: () => splitNamesById[currentSplit.id] ?? '',
      setDisplayName: (name: string) =>
        setSplitNamesById(currentSplit.id, name),
      registerContentChangeListener: (
        cb: (payload: SplitEventPayload[SplitEvent.ContentChange]) => void
      ) => {
        if (!contentChangeListeners.has(currentSplit.id)) {
          contentChangeListeners.set(currentSplit.id, new Set());
        }
        contentChangeListeners.get(currentSplit.id)!.add(cb);
      },
      unregisterContentChangeListener: (
        cb: (payload: SplitEventPayload[SplitEvent.ContentChange]) => void
      ) => {
        const listeners = contentChangeListeners.get(currentSplit.id);
        if (listeners) {
          listeners.delete(cb);
          if (listeners.size === 0) {
            contentChangeListeners.delete(currentSplit.id);
          }
        }
      },
    };
  };

  function createNewSplit(
    content?: SplitContent,
    activate?: boolean
  ): SplitHandle {
    const initialContent = content ?? DEFAULT_SPLIT_CONTENT;
    const isDefault = sameContent(initialContent, DEFAULT_SPLIT_CONTENT);

    if (isDuplicateSplit(state.splits, initialContent)) {
      const existingSplit = state.splits.find(
        (s) =>
          s.content.type === initialContent.type &&
          s.content.id === initialContent.id
      );

      return getSplit(existingSplit!.id)!;
    }

    const split = buildSplit(initialContent, isDefault);

    setState('splits', (previousSplits) => [...previousSplits, split]);

    const handle = getSplit(split.id)!;

    if (activate) {
      handle.activate();
    }

    dispatchEvent(SplitEvent.Insert, {
      splitId: split.id,
      activate,
      initial: initialContent,
    });

    return handle;
  }

  function removeSplit(id: SplitId, createNewOnEmpty: boolean = true) {
    const idx = state.splits.findIndex((s) => s.id === id);
    if (idx < 0) return;

    contentChangeListeners.delete(id);
    setSplitNamesById(
      produce((map) => {
        delete map[id];
        return map;
      })
    );

    const nextSplits = state.splits.filter((s) => s.id !== id);
    setState('splits', reconcile(nextSplits));

    dispatchEvent(SplitEvent.Remove, { splitId: id, splitIndex: idx });

    if (nextSplits.length === 0 && createNewOnEmpty) {
      createNewSplit(DEFAULT_SPLIT_CONTENT);
    }
  }

  function hasSplit(type: BlockName | 'component', id: string): boolean {
    return !!state.splits.find(
      (s) => s.content.type === type && s.content.id === id
    );
  }

  function getSplitByContent(
    type: BlockName | 'component',
    id: string
  ): SplitHandle | undefined {
    const match = state.splits.find(
      (s) => s.content.type === type && s.content.id === id
    );
    if (!match) return;
    return getSplit(match.id);
  }

  function reconcileSplits(newSplits: SplitContent[]) {
    let newState: SplitState[] = [];
    const currentCompositeSplits = state.splits.map(keyOfSplitState);
    const newCompositeSplits = newSplits.map(keyOfSplitContent);
    let changed =
      newCompositeSplits.join(',') !== currentCompositeSplits.join(',');

    if (!changed) return;

    const lookup = (type: BlockName, id: string) =>
      state.splits.find((s) => s.content.type === type && s.content.id === id);

    const splitsToRemove = [
      // just remount all the components
      ...state.splits.filter((s) => s.content.type === 'component'),
      // previous blocks that are not in the new splits
      ...state.splits.filter(
        (s) =>
          s.content.type !== 'component' &&
          !newCompositeSplits.includes(keyOfSplitState(s))
      ),
    ];

    for (const splitToRemove of splitsToRemove) {
      removeSplit(splitToRemove.id, false);
    }

    for (const split of newSplits) {
      if (split.type === 'component') {
        newState.push(buildSplit(split));
      } else {
        newState.push(lookup(split.type, split.id) ?? buildSplit(split));
      }
    }

    setState('splits', reconcile(newState));
  }

  const lastEvent = createMemo(() => state.events[state.events.length - 1]);

  for (const split of initial) {
    createNewSplit(split, true);
  }

  const tabTitle = () => {
    if (state.activeSplitId === undefined) return undefined;
    return splitNamesById[state.activeSplitId] || undefined;
  };

  return {
    splits: () => state.splits,
    activeSplitId: () => state.activeSplitId,
    lastActiveSplitId: () => state.lastActiveSplitId,
    events: lastEvent,
    reconcile: reconcileSplits,
    getSplit,
    removeSplit,
    createNewSplit,
    getUrlSegments,
    getUrl,
    activateSplit,
    hasSplit,
    getSplitByContent,
    spotlightSplit,
    unSpotlightSplit,
    toggleSpotlightSplit,
    tabTitle,
    returnFocus: () => dispatchEvent(SplitEvent.ReturnFocus, undefined),
    resizeContext,
    setResizeContext,
  };
}
