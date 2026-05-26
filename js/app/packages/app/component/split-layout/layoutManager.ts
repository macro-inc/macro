import { LIST_VIEW_ID } from '@app/constants/list-views';
import type {
  BlockAlias,
  BlockAliasContext,
  BlockComponentProps,
  BlockName,
} from '@core/block';
import type { ResizeZoneCtx } from '@core/component/Resize/types';
import { isBlockAlias, resolveBlockAlias } from '@core/constant/allBlocks';
import type {
  BlockInstanceHandle,
  BlockOrchestrator,
} from '@core/orchestrator';
import { useFocusLock } from '@core/util/createControlledOpenSignal';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSXElement,
} from 'solid-js';
import { createStore, produce, reconcile, type Store } from 'solid-js/store';
import {
  type ComponentMeta,
  type ComponentMetaMap,
  resolveComponent,
} from './componentRegistry';
import { createHistory, type History } from './history';

const ENABLE_DEFAULT_ALWAYS_IN_HISTORY = false;

export type SplitId = string & { readonly SplitId: unique symbol };
type SplitKey = `${BlockName | BlockAlias | 'component'}:${string}`;

/**
 * Per-entry runtime state, opaque at the layout-manager level.
 * Owned by components via `useEntryState`. Survives back/forward within a
 * split's history. Does not contribute to entry identity.
 */
export type EntryState = Record<string, unknown>;

export type SplitContent =
  | {
      type: BlockName | BlockAlias;
      id: string;
      params?: BlockComponentProps[BlockName];
      aliasContext?: BlockAliasContext;
      state?: EntryState;
    }
  | {
      type: 'component';
      id: string;
      params?: Record<string, unknown>;
      state?: EntryState;
    };

export type SplitContentType = SplitContent['type'];

/**
 * Why a split's mounted content changed. Read via `useNavigationCause` to
 * adjust behavior that depends on whether the user arrived fresh vs. via
 * back/forward (e.g. don't auto-focus the search bar on history navigation).
 */
export type NavigationCause =
  | 'fresh'
  | 'history-back'
  | 'history-forward'
  | 'replace';

function sameContent(a: SplitContent, b: SplitContent): boolean {
  return a.type === b.type && a.id === b.id;
}

function getAliasOrType(content: SplitContent): string {
  return content.type === 'component'
    ? content.type
    : content.aliasContext?.alias || content.type;
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
  aliasContext?: BlockAliasContext;
};

type ComponentMount = {
  kind: 'component';
  name: string;
  element: ElementFn;
  meta: Store<ComponentMeta>;
  updateMeta: (data: Omit<ComponentMeta, 'kind'>) => void;
};

export type SplitMount = BlockMount | ComponentMount;

export type PopoverSplitOptions = {
  content: SplitContent;
  onClose?: () => void;
};

export type PopoverSplitHandle = {
  close: () => void;
  isOpen: () => boolean;
  content: () => SplitContent;
  id: string;
};

export type ReferredFrom =
  | 'list-view'
  | 'kommand-menu'
  | 'mention'
  | 'attachment'
  | 'launcher'
  | 'sidebar'
  | 'dock'
  | 'entity-actions-menu'
  | 'hotkey'
  | 'quick-access'
  | 'file-upload'
  | 'search'
  | null;

export type SplitState = {
  id: SplitId;
  history: History<SplitContent>;
  content: SplitContent; // mirror of current history entry
  mount: SplitMount; // contains pinned element
  referredFrom: ReferredFrom;
  lastNavigationCause: NavigationCause;
};

export type CreateNewSplitOptions = {
  content?: SplitContent;
  activate?: boolean;
  allowDuplicate?: boolean;
  referredFrom: ReferredFrom;
  /**
   * Optional prior navigation entries to pre-populate this split's history stack.
   * The `content` field is appended as the final (current) entry.
   */
  initialHistory?: SplitContent[];
};

export type OpenWithSplitOptions = {
  mergeHistory?: boolean;
  activate?: boolean;
  referredFrom?: ReferredFrom;
  allowDuplicate?: boolean;
  replaceWhenFull?: boolean;
  /** If true, prefers opening in a new split. May still replace if layout is at capacity. */
  preferNewSplit?: boolean;
  handle?: SplitHandle;
};

/**
 * A navigation interceptor registered by, e.g. mobile swipe layout.
 * Called at the start of `openWithSplit`. Return `{ handled: true }` to consume
 * the navigation; return `{ handled: false }` to let the normal split logic run.
 */
export type NavigationInterceptor = (
  content: SplitContent,
  options: OpenWithSplitOptions
) => { handled: boolean };

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
    cause: NavigationCause;
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

/**
 * If a split layout helper passes and aliased block type, make sure to wrap
 * that with the alias info.
 * @param content
 * @returns
 */
function attachAliasContext(content: SplitContent): SplitContent {
  if (content.type !== 'component' && isBlockAlias(content.type)) {
    return {
      ...content,
      aliasContext: {
        alias: content.type,
        baseType: resolveBlockAlias(content.type),
      },
    };
  }
  return content;
}

export type SplitManager = {
  readonly splits: Accessor<ReadonlyArray<SplitState>>;
  readonly activeSplitId: Accessor<SplitId | undefined>;
  readonly activeSplit: Accessor<SplitHandle | undefined>;
  readonly lastActiveSplitId: Accessor<SplitId | undefined>;
  readonly events: Accessor<SplitEventWithType>;
  readonly resizeContext: Accessor<ResizeZoneCtx | undefined>;

  // methods
  /** Get a split by its split id */
  getSplit: (id: SplitId) => SplitHandle | undefined;

  /** Remove a split by its split id */
  removeSplit: (id: SplitId) => void;

  /** Create a new split with the provided initial content and activate it */
  createNewSplit: (options: CreateNewSplitOptions) => SplitHandle;

  openWithSplit: (
    content: SplitContent,
    options?: OpenWithSplitOptions
  ) => SplitHandle | undefined;

  /** Set a split as active by its split id  */
  activateSplit: (id: SplitId) => void;

  spotlightSplit: (id: SplitId) => void;

  unSpotlightSplit: () => void;

  toggleSpotlightSplit: (id: SplitId) => void;

  getOrchestrator: () => BlockOrchestrator;

  canAppendSplit: () => boolean;

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

  /** Replace all splits with a single split containing the given content. */
  replaceAllSplits: (
    content: SplitContent,
    options?: { referredFrom?: string | null }
  ) => SplitHandle;

  /** Check if a split exists by its split id */
  hasSplit: (type: SplitContentType, id: string) => boolean;

  /** Get a potential split id by its content type and id */
  getSplitByContent: {
    <K extends keyof ComponentMetaMap>(
      type: 'component',
      id: K
    ): SplitHandle<ComponentMetaMap[K]> | undefined;
    (type: SplitContentType, id: string): SplitHandle | undefined;
  };

  /** Get a reactive string that is the display name of the active split. */
  tabTitle: () => string | undefined;

  /** A function to return focus to the most recent split. */
  returnFocus: () => void;

  /** Set the layout resize context from the component tree. */
  setResizeContext: (cts: ResizeZoneCtx) => void;

  /** Create a temporary popover split that renders content in a modal dialog */
  createPopoverSplit: (options: PopoverSplitOptions) => PopoverSplitHandle;

  /** Get all active popover splits */
  getActivePopovers: () => PopoverSplitHandle[];

  /** Close all popover splits */
  closeAllPopovers: () => void;

  /** Count of splits not excluded by the current exclusion filter. */
  getVisibleSplitCount: () => number;

  /**
   * Register a predicate that marks certain splits as excluded — excluded splits
   * are hidden from URL encoding, duplicate detection, and content lookup.
   * Used for mobile swipe back behavior, where we want to ignore the bg split.
   */
  setExclusionFilter: (
    fn: ((split: SplitState) => boolean) | undefined
  ) => void;

  /**
   * Register a navigation interceptor. Called at the start of `openWithSplit`;
   * if it returns `{ handled: true }` the normal split logic is skipped.
   */
  setNavigationInterceptor: (fn: NavigationInterceptor | undefined) => void;

  /** Get reactive accessor to popovers map */
  popovers: () => Map<
    string,
    {
      id: string;
      content: SplitContent;
      mount: SplitMount;
      isOpen: boolean;
      options: PopoverSplitOptions;
      handle: PopoverSplitHandle;
    }
  >;
} & UrlCapabilities;

export type SplitHandle<TMeta extends ComponentMeta = ComponentMeta> = {
  unregisterContentChangeListener: (
    cb: (payload: SplitEventPayload[SplitEvent.ContentChange]) => void
  ) => void;
  registerContentChangeListener: (
    cb: (payload: SplitEventPayload[SplitEvent.ContentChange]) => void
  ) => void;
  replace: (options: {
    next: SplitContent;
    mergeHistory?: boolean;
    referredFrom?: ReferredFrom;
  }) => void;
  removeFromHistory: (predicate: (content: SplitContent) => boolean) => void;
  /**
   * Jump to the most-recent prior history entry matching `predicate` (or
   * forward to the closest match if none earlier). Captures current entry
   * state first, like back/forward. Returns true if a match was found and
   * navigated to; false if no match (history left unchanged).
   *
   * Use for "open this view if it's already in my history, otherwise fall
   * back to a fresh push" patterns (e.g. sidebar nav).
   */
  goToEntry: (predicate: (content: SplitContent) => boolean) => boolean;
  toggleSpotlight: (force?: boolean) => void;
  setDisplayName: (name: string) => void;
  canGoForward: () => boolean;
  content: () => SplitContent;
  isSpotLight: () => boolean;
  isPopover: () => boolean;
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
  /** Returns the content item one step back in this split's history, without mutating. */
  previousContent: () => SplitContent | null;
  /**
   * Returns all history items up to and including the current one.
   */
  history: () => SplitContent[];
  id: SplitId;
  /** Component metadata store (only available for component splits) */
  meta: () => Store<TMeta> | undefined;
  /** Update component metadata (only available for component splits) */
  updateMeta: ((data: Omit<TMeta, 'kind'>) => void) | undefined;
  referredFrom: () => ReferredFrom;
  /**
   * Cause of the most recent navigation event for this split. `'fresh'` on
   * initial mount, then updated by back/forward/replace/push.
   */
  lastNavigationCause: () => NavigationCause;
  /**
   * Register a function that captures a slice of this split's current entry
   * state. The captor is invoked just before any navigation away from the
   * current entry; its return value is merged into the entry's `state` field
   * keyed by `key`. Returns a teardown.
   */
  registerEntryStateCaptor: (key: string, getter: () => unknown) => () => void;
  /**
   * Read the `state` blob attached to this split's *current* history entry.
   * Returns `undefined` if no state has been captured.
   */
  currentEntryState: () => EntryState | undefined;
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
    const resolved = resolveComponent(content.id, content.params);
    const [meta, setMeta] = createStore<ComponentMeta>(
      resolved.initialMeta ?? {}
    );
    const updateMeta = (data: Omit<ComponentMeta, 'kind'>) => {
      setMeta({ kind: content.id, ...data } as ComponentMeta);
    };
    return {
      kind: 'component',
      name: content.id,
      element: resolved.element,
      meta,
      updateMeta,
    };
  }

  const blockType = resolveBlockAlias(content.type);
  const handle = orchestrator.createBlockInstance(blockType, content.id, {
    aliasContext: content.aliasContext,
    params: content.params,
  });

  return {
    kind: 'block',
    type: content.type,
    id: content.id,
    handle,
    element: handle.element,
    aliasContext: content.aliasContext,
  };
}

function sameIdentity(a: SplitContent, b: SplitContent): boolean {
  if (a.type !== b.type) return false;
  return a.id === b.id;
}

function sameNonComponentIdentity(a: SplitContent, b: SplitContent): boolean {
  if (a.type === 'component' || b.type === 'component') return false;
  // check on the resolved block so you cannot open `/md/{ID}/task{ID}`
  if (resolveBlockAlias(a.type) !== resolveBlockAlias(b.type)) return false;
  return a.id === b.id;
}

function isDuplicateSplit(
  splits: SplitState[],
  content: SplitContent,
  isExcluded: (split: SplitState) => boolean = () => false
): boolean {
  return splits
    .filter((s) => !isExcluded(s))
    .some((split) => sameNonComponentIdentity(split.content, content));
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
    popovers: Map<
      string,
      {
        id: string;
        content: SplitContent;
        mount: SplitMount;
        isOpen: boolean;
        options: PopoverSplitOptions;
        handle: PopoverSplitHandle;
      }
    >;
  }>({
    splits: [],
    activeSplitId: undefined,
    lastActiveSplitId: undefined,
    spotlightId: undefined,
    events: [],
    popovers: new Map(),
  });

  const [resizeContext, setResizeContext] = createSignal<ResizeZoneCtx>();

  let exclusionFilter: ((split: SplitState) => boolean) | undefined;
  let navigationInterceptor: NavigationInterceptor | undefined;
  const isExcluded = (split: SplitState) => exclusionFilter?.(split) ?? false;

  const canAppendSplit = createMemo(
    () => resizeContext()?.canFit({ minSize: 400 }) ?? true
  );

  const [splitNamesById, setSplitNamesById] = createStore<{
    [id: SplitId]: string;
  }>({});

  const contentChangeListeners = new Map<
    SplitId,
    Set<(payload: SplitEventPayload[SplitEvent.ContentChange]) => void>
  >();

  /**
   * Per-split, per-key captors. A captor returns the current value of a
   * component-owned state slice. Right before navigating away from the current
   * entry, we invoke all captors for that split and write the resulting blob
   * to the entry's `state` field via `history.replaceCurrent`.
   */
  const entryStateCaptors = new Map<SplitId, Map<string, () => unknown>>();

  function captureCurrentEntryState(split: SplitState): void {
    const captors = entryStateCaptors.get(split.id);
    if (!captors || captors.size === 0) return;
    const items = split.history.items;
    const idx = split.history.index;
    if (idx < 0 || idx >= items.length) return;
    const currentItem = items[idx];

    const state: EntryState = {};
    for (const [key, getter] of captors) {
      try {
        state[key] = getter();
      } catch (err) {
        console.error(
          `Entry state captor for split ${split.id} key "${key}" threw`,
          err
        );
      }
    }
    const next = { ...currentItem, state } as SplitContent;
    split.history.replaceCurrent(next);
    // Mirror onto SplitState.content so live reads see the captured state.
    setState('splits', (s) => {
      const i = s.findIndex((x) => x.id === split.id);
      if (i < 0) return s;
      return s.with(i, { ...s[i], content: next });
    });
  }

  const DEFAULT_SPLIT_CONTENT = defaultSplitContent ?? {
    type: 'component',
    id: LIST_VIEW_ID.inbox,
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

  const findSplitById = (id: SplitId) => state.splits.find((s) => s.id === id);
  const splitIndexById = (id: SplitId) =>
    state.splits.findIndex((s) => s.id === id);

  function buildSplit(options: {
    initialContent: SplitContent;
    isDefault?: boolean;
    referredFrom?: ReferredFrom;
    initialHistory?: SplitContent[];
  }): SplitState {
    const { initialContent, isDefault, referredFrom, initialHistory } = options;
    const id = newSplitId();
    const history = createHistory<SplitContent>();
    const content = attachAliasContext(initialContent);

    if (initialHistory && initialHistory.length > 0) {
      // Pre-populate prior navigation entries so previousContent() is accurate.
      for (const item of initialHistory) {
        history.push(attachAliasContext(item));
      }
    } else {
      // If enabled, we always want to be able to go back to the default split
      if (!isDefault && ENABLE_DEFAULT_ALWAYS_IN_HISTORY) {
        history.push(DEFAULT_SPLIT_CONTENT);
      }
    }

    history.push(content);
    const mount = createPinnedMount(orchestrator, content);

    return {
      id,
      history,
      content,
      mount,
      referredFrom: referredFrom ?? null,
      lastNavigationCause: 'fresh',
    };
  }

  function reattach(
    split: SplitState,
    next: SplitContent,
    referredFrom?: ReferredFrom,
    cause: NavigationCause = 'fresh'
  ) {
    const otherSplits = state.splits.filter((s) => s.id !== split.id);
    const content = attachAliasContext(next);
    if (isDuplicateSplit(otherSplits, next)) return;

    const splitIndex = splitIndexById(split.id);
    if (splitIndex >= 0 && !sameIdentity(split.content, content)) {
      setSplitNamesById(
        produce((map) => {
          delete map[split.id];
          return map;
        })
      );

      const payload: SplitEventPayload[SplitEvent.ContentChange] = {
        splitId: split.id,
        splitIndex,
        newContent: content,
        previousContent: split.content,
        cause,
      };

      dispatchEvent(SplitEvent.ContentChange, payload);

      const listeners = contentChangeListeners.get(split.id);
      if (listeners) {
        listeners.forEach((listener) => {
          listener(payload);
        });
      }
    }

    if (sameIdentity(split.content, content)) {
      // Update referredFrom if provided, even if content is the same
      if (referredFrom !== undefined) {
        return setState('splits', (s) => {
          const i = s.findIndex((x) => x.id === split.id);
          if (i < 0) return s;
          const target = {
            ...s[i],
            content: content,
            referredFrom,
            lastNavigationCause: cause,
          };
          return s.with(i, target);
        });
      }
      return setState('splits', (s) => {
        const i = s.findIndex((x) => x.id === split.id);
        if (i < 0) return s;
        const target = {
          ...s[i],
          content: content,
          lastNavigationCause: cause,
        };
        return s.with(i, target);
      });
    }

    const newMount = createPinnedMount(orchestrator, content);

    setState('splits', (s) => {
      const i = s.findIndex((x) => x.id === split.id);
      if (i < 0) return s;
      const target = {
        ...s[i],
        content,
        mount: newMount,
        lastNavigationCause: cause,
        ...(referredFrom !== undefined && { referredFrom }),
      };
      return s.with(i, target);
    });
  }

  function back(id: SplitId) {
    const i = splitIndexById(id);
    if (i < 0) return console.error(`Split with id ${id} not found`);

    const split = state.splits[i];
    if (!split.history.canGoBack()) return;

    captureCurrentEntryState(split);

    const prev = split.history.back();
    if (!prev) return;

    reattach(split, prev, undefined, 'history-back');
  }

  function forward(id: SplitId) {
    const i = splitIndexById(id);
    if (i < 0) return console.error(`Split with id ${id} not found`);

    const split = state.splits[i];
    if (!split.history.canGoForward()) return;

    captureCurrentEntryState(split);

    const next = split.history.forward();
    if (!next) return;

    reattach(split, next, undefined, 'history-forward');
  }

  function removeFromHistory(
    id: SplitId,
    predicate: (content: SplitContent) => boolean
  ) {
    const i = splitIndexById(id);
    if (i < 0) return console.error(`Split with id ${id} not found`);

    const split = state.splits[i];
    const next = split.history.remove(predicate);
    if (!next) return;

    reattach(split, next, undefined, 'replace');
  }

  function goToEntry(
    id: SplitId,
    predicate: (content: SplitContent) => boolean
  ): boolean {
    const i = splitIndexById(id);
    if (i < 0) {
      console.error(`Split with id ${id} not found`);
      return false;
    }
    const split = state.splits[i];
    const items = split.history.items;
    const currentIdx = split.history.index;
    if (items.length === 0) return false;

    // Prefer the closest match looking backwards (more common case — the
    // user just came from there). Fall back to looking forward.
    let targetIdx = -1;
    for (let j = currentIdx - 1; j >= 0; j--) {
      if (predicate(items[j])) {
        targetIdx = j;
        break;
      }
    }
    if (targetIdx === -1) {
      for (let j = currentIdx + 1; j < items.length; j++) {
        if (predicate(items[j])) {
          targetIdx = j;
          break;
        }
      }
    }
    if (targetIdx === -1 || targetIdx === currentIdx) return false;

    captureCurrentEntryState(split);
    const target = split.history.goToIndex(targetIdx);
    if (!target) return false;
    const cause: NavigationCause =
      targetIdx < currentIdx ? 'history-back' : 'history-forward';
    reattach(split, target, undefined, cause);
    return true;
  }

  /**
   * Replace the content of a split with the provided content. If mergeHistory is true, the current history index will be replaced with the new content.
   */
  function replace(
    id: SplitId,
    options: {
      next: SplitContent;
      mergeHistory?: boolean;
      referredFrom?: ReferredFrom;
    }
  ) {
    const { next, mergeHistory, referredFrom } = options;
    const i = splitIndexById(id);
    if (i < 0) return console.error(`Split with id ${id} not found`);

    const content = attachAliasContext(next);

    const split = state.splits[i];
    captureCurrentEntryState(split);
    if (mergeHistory) {
      split.history.merge(content);
    } else {
      split.history.push(content);
    }

    reattach(split, content, referredFrom, mergeHistory ? 'replace' : 'fresh');
  }

  function reset(id: SplitId) {
    const i = splitIndexById(id);
    if (i < 0) return console.error(`Split with id ${id} not found`);

    const split = state.splits[i];
    split.history = createHistory<SplitContent>();
    reattach(split, DEFAULT_SPLIT_CONTENT, undefined, 'fresh');
  }

  const getUrlSegments = () => {
    return state.splits
      .filter((s) => !isExcluded(s))
      .flatMap((s) => [getAliasOrType(s.content), s.content.id])
      .map(String);
  };

  const getUrl = () => {
    const visibleSplits = state.splits.filter((s) => !isExcluded(s));
    return (
      visibleSplits.map((s) => getAliasOrType(s.content)).join('/') +
      '/' +
      visibleSplits.map((s) => s.content.id).join('/')
    );
  };

  function activateSplit(id: SplitId) {
    const current = state.activeSplitId;
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
    const split = findSplitById(id);
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
    const s = () => findSplitById(id);
    const currentSplit = s();
    if (!currentSplit) return;
    // s() can return undefined if this split is removed from state.splits before
    // all reactive consumers have stopped reading it. lastKnownContent prevents
    // this error and ensures consumers see the most recent content, not the initial one.
    let lastKnownContent: SplitContent = currentSplit.content;
    const content = () => {
      const current = s()?.content;
      if (current !== undefined) lastKnownContent = current;
      return lastKnownContent;
    };

    return {
      id: currentSplit.id,
      content,
      activate: () => activateSplit(currentSplit.id),
      canGoBack: () => currentSplit.history.canGoBack(),
      canGoForward: () => currentSplit.history.canGoForward(),
      goBack: () => back(currentSplit.id),
      reset: () => reset(currentSplit.id),
      goForward: () => forward(currentSplit.id),
      replace: ({ next, mergeHistory = false, referredFrom }) =>
        replace(currentSplit.id, { next, mergeHistory, referredFrom }),
      removeFromHistory: (predicate: (content: SplitContent) => boolean) => {
        removeFromHistory(currentSplit.id, predicate);
      },
      goToEntry: (predicate: (content: SplitContent) => boolean) =>
        goToEntry(currentSplit.id, predicate),
      previousContent: () => {
        const s = findSplitById(currentSplit.id);
        if (!s) return null;
        const idx = s.history.index;
        return idx > 0 ? (s.history.items[idx - 1] ?? null) : null;
      },
      history: () => {
        const s = findSplitById(currentSplit.id);
        if (!s) return [];
        return s.history.items.slice(0, s.history.index + 1) as SplitContent[];
      },
      close: () => {
        // If there's only one split and it's the default split, then no-op
        if (state.splits.length <= 1) {
          // If it's not the default split, replace it with the default
          if (!sameContent(content(), DEFAULT_SPLIT_CONTENT))
            replace(currentSplit.id, {
              next: DEFAULT_SPLIT_CONTENT,
              referredFrom: null,
            });

          return;
        }

        removeSplit(currentSplit.id);
      },
      getUrlSegments: () =>
        [getAliasOrType(content()), content().id].map(String),
      getUrl: () => getAliasOrType(content()) + '/' + content().id,
      isFirst: () => state.splits.at(0)?.id === id,
      isLast: () => state.splits.at(-1)?.id === id,
      isActive: () => currentSplit.id === state.activeSplitId,
      isSpotLight: () => state.spotlightId === currentSplit.id,
      isPopover: () => state.popovers.has(currentSplit.id),
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
      meta: () =>
        currentSplit.mount.kind === 'component'
          ? currentSplit.mount.meta
          : undefined,
      updateMeta:
        currentSplit.mount.kind === 'component'
          ? currentSplit.mount.updateMeta
          : undefined,
      referredFrom: () => s()?.referredFrom ?? null,
      lastNavigationCause: () => s()?.lastNavigationCause ?? 'fresh',
      registerEntryStateCaptor: (key: string, getter: () => unknown) => {
        let perSplit = entryStateCaptors.get(currentSplit.id);
        if (!perSplit) {
          perSplit = new Map();
          entryStateCaptors.set(currentSplit.id, perSplit);
        }
        perSplit.set(key, getter);
        return () => {
          const map = entryStateCaptors.get(currentSplit.id);
          if (!map) return;
          if (map.get(key) === getter) map.delete(key);
          if (map.size === 0) entryStateCaptors.delete(currentSplit.id);
        };
      },
      currentEntryState: () => {
        const live = s();
        if (!live) return undefined;
        // Read through the store getter so callers see the latest captured
        // state (mirrored from history into split.content on capture).
        const c = live.content as { state?: EntryState };
        return c.state;
      },
    };
  };

  function createNewSplit(options: CreateNewSplitOptions): SplitHandle {
    const { content, activate, referredFrom, allowDuplicate, initialHistory } =
      options;
    const initialContent = content ?? DEFAULT_SPLIT_CONTENT;
    const isDefault = sameContent(initialContent, DEFAULT_SPLIT_CONTENT);

    if (
      !allowDuplicate &&
      isDuplicateSplit(state.splits, initialContent, isExcluded)
    ) {
      const existingSplit = state.splits.find(
        (s) =>
          s.content.type === initialContent.type &&
          s.content.id === initialContent.id
      );

      return getSplit(existingSplit!.id)!;
    }

    const split = buildSplit({
      initialContent,
      isDefault,
      referredFrom,
      initialHistory,
    });

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
    const idx = splitIndexById(id);
    if (idx < 0) return;

    contentChangeListeners.delete(id);
    entryStateCaptors.delete(id);
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
      createNewSplit({ content: DEFAULT_SPLIT_CONTENT, referredFrom: null });
    }
  }

  function hasSplit(type: SplitContentType, id: string): boolean {
    return !!state.splits.find(
      (s) => s.content.type === type && s.content.id === id
    );
  }

  function getSplitByContent(
    type: SplitContentType,
    id: string
  ): SplitHandle | undefined {
    const match = state.splits.find(
      (s) => s.content.type === type && s.content.id === id && !isExcluded(s)
    );
    if (!match) return;
    return getSplit(match.id);
  }

  function reconcileSplits(newSplits: SplitContent[]) {
    // URL segments are produced by getUrlSegments(), which excludes excluded splits.
    const visibleSplits = state.splits.filter((s) => !isExcluded(s));
    const currentKeys = visibleSplits.map(keyOfSplitState);
    const newKeys = newSplits.map(keyOfSplitContent);
    const changed = newKeys.join(',') !== currentKeys.join(',');

    if (!changed) return;

    // Build the result array by position, preserving excluded splits unchanged.
    const resultSplits: SplitState[] = [];
    const usedIds = new Set<SplitId>();

    for (const split of state.splits) {
      if (isExcluded(split)) {
        resultSplits.push(split);
        usedIds.add(split.id);
      }
    }

    for (let i = 0; i < newSplits.length; i++) {
      const newContent = newSplits[i];
      const splitAtSameIndex = visibleSplits[i];

      // Reuse split at same index if content matches
      if (
        splitAtSameIndex &&
        sameContent(splitAtSameIndex.content, newContent)
      ) {
        resultSplits.push(splitAtSameIndex);
        usedIds.add(splitAtSameIndex.id);
      } else {
        // Build new split with fresh history
        const newSplit = buildSplit({
          initialContent: newContent,
          referredFrom: null,
        });
        // Reuse the ID from the split at the same index to keep ids stable
        if (splitAtSameIndex) {
          newSplit.id = splitAtSameIndex.id;
          usedIds.add(splitAtSameIndex.id);
          setSplitNamesById(
            produce((map) => {
              delete map[splitAtSameIndex.id];
              return map;
            })
          );
        }
        resultSplits.push(newSplit);
      }
    }

    // Clean up contentChangeListeners and splitNamesById for removed splits
    for (const split of state.splits) {
      if (!usedIds.has(split.id)) {
        contentChangeListeners.delete(split.id);
        entryStateCaptors.delete(split.id);
        setSplitNamesById(
          produce((map) => {
            delete map[split.id];
            return map;
          })
        );
      }
    }

    // Update state in a single batch
    setState('splits', resultSplits);
  }

  const lastEvent = createMemo(() => state.events[state.events.length - 1]);

  for (const split of initial) {
    createNewSplit({ content: split, activate: true, referredFrom: null });
  }

  const tabTitle = () => {
    if (state.activeSplitId === undefined) return undefined;
    return splitNamesById[state.activeSplitId] || undefined;
  };

  // Popover split functions
  function createPopoverSplit(
    options: PopoverSplitOptions
  ): PopoverSplitHandle {
    const id = `popover-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Acquire focus lock BEFORE any state updates to capture the correct element
    const focusLock = useFocusLock(`popover-${id}`);
    focusLock.acquire();

    const mount = createPinnedMount(orchestrator, options.content);

    const handle: PopoverSplitHandle = {
      id,
      close: () => {
        // Release focus lock to return focus to previously focused element
        focusLock.release();

        setState('popovers', (prev) => {
          const newMap = new Map(prev);
          const popover = newMap.get(id);
          if (popover) {
            newMap.set(id, { ...popover, isOpen: false });
            // Schedule cleanup after a brief delay to allow for animations
            setTimeout(() => {
              setState('popovers', (prev) => {
                const cleanupMap = new Map(prev);
                cleanupMap.delete(id);
                return cleanupMap;
              });
            }, 300);
          }
          return newMap;
        });
        options.onClose?.();
      },
      isOpen: () => {
        const popover = state.popovers.get(id);
        return popover?.isOpen ?? false;
      },
      content: () => options.content,
    };

    const popoverData = {
      id,
      content: options.content,
      mount,
      isOpen: true,
      options,
      handle, // Store the handle so getActivePopovers can return it
    };

    setState('popovers', (prev) => {
      const newMap = new Map(prev);
      newMap.set(id, popoverData);
      return newMap;
    });

    return handle;
  }

  function getActivePopovers(): PopoverSplitHandle[] {
    return Array.from(state.popovers.values())
      .filter((popover) => popover.isOpen)
      .map((popover) => popover.handle);
  }

  function closeAllPopovers(): void {
    const popovers = Array.from(state.popovers.values());
    for (const popover of popovers) {
      popover.handle.close();
    }
  }

  function openWithSplit(
    content: SplitContent,
    options: OpenWithSplitOptions = {}
  ): SplitHandle | undefined {
    if (navigationInterceptor) {
      const result = navigationInterceptor(content, options);
      if (result.handled) return undefined;
    }

    const existingSplit = getSplitByContent(content.type, content.id);

    if (!options.allowDuplicate && existingSplit) {
      if (options.activate !== false) {
        existingSplit.activate();
      }

      return existingSplit;
    }

    let splitHandle = options.handle;

    if (!splitHandle) {
      splitHandle = state.activeSplitId
        ? getSplit(state.activeSplitId)
        : undefined;
    }

    const shouldReplaceWhenFull =
      options.replaceWhenFull !== false && !canAppendSplit();

    const shouldReplace = !options.preferNewSplit || shouldReplaceWhenFull;

    if (splitHandle && shouldReplace) {
      splitHandle.replace({
        next: content,
        referredFrom: options.referredFrom ?? null,
        mergeHistory: options.mergeHistory,
      });

      if (options.activate !== false) {
        splitHandle.activate();
      }

      return splitHandle;
    } else {
      return createNewSplit({
        content,
        activate: options.activate ?? true,
        referredFrom: options.referredFrom ?? null,
        allowDuplicate: options.allowDuplicate,
      });
    }
  }

  function replaceAllSplits(
    content: SplitContent,
    options: { referredFrom?: ReferredFrom } = {}
  ): SplitHandle {
    reconcileSplits([content]);
    const handle = getSplitByContent(content.type, content.id);
    if (handle) {
      handle.activate();
      return handle;
    }
    return createNewSplit({
      content,
      activate: true,
      referredFrom: options.referredFrom ?? null,
    });
  }

  const activeSplit = () => {
    const id = state.activeSplitId;
    return id ? getSplit(id) : undefined;
  };

  return {
    splits: () => state.splits,
    activeSplitId: () => state.activeSplitId,
    activeSplit,
    lastActiveSplitId: () => state.lastActiveSplitId,
    events: lastEvent,
    reconcile: reconcileSplits,
    replaceAllSplits,
    getSplit,
    openWithSplit,
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
    getOrchestrator: () => orchestrator,
    createPopoverSplit,
    getActivePopovers,
    closeAllPopovers,
    popovers: () => state.popovers,
    canAppendSplit,
    getVisibleSplitCount: () =>
      state.splits.filter((s) => !isExcluded(s)).length,
    setExclusionFilter: (fn) => {
      exclusionFilter = fn;
    },
    setNavigationInterceptor: (fn) => {
      navigationInterceptor = fn;
    },
  };
}
