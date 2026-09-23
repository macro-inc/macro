import { LIST_VIEW_ID, type ListView } from '@app/constants/list-views';
import { parseAgentsRoute } from '@app/features/agents-view/core/route';
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
import deepEqual from 'fast-deep-equal';
import {
  type Accessor,
  batch,
  createMemo,
  createSignal,
  type JSXElement,
  onCleanup,
} from 'solid-js';
import { createStore, produce, reconcile, type Store } from 'solid-js/store';
import {
  type ComponentMeta,
  type ComponentMetaMap,
  resolveComponent,
} from './componentRegistry';
import {
  type ContentInstance,
  createContentInstanceRegistry,
  sameContentIdentity,
} from './contentInstanceRegistry';
import { createHistory, type History } from './history';
import { DEFAULT_SPLIT_MIN_WIDTH } from './splitContentSizing';

const ENABLE_DEFAULT_ALWAYS_IN_HISTORY = false;

export type SplitId = string & { readonly SplitId: unique symbol };
type SplitKey = `${BlockName | BlockAlias | 'component'}:${string}`;

/**
 * Per-entry runtime state, opaque at the layout-manager level.
 * Owned by components via `useEntryState`. Survives back/forward within a
 * split's history. Does not contribute to entry identity.
 */
export type EntryState = Record<string, unknown>;

type SplitContentState = {
  /**
   * Whether to preserve the params originally passed when navigating to this content.
   * If false, then it only does so the first time.
   */
  preserveParams?: boolean;
  state?: EntryState;
  /** Per-entry integration metadata, opaque to the layout manager. */
  entryMetadata?: unknown;
};

export type SplitContent = SplitContentState &
  (
    | {
        type: BlockName | BlockAlias;
        id: string;
        params?: BlockComponentProps[BlockName];
        aliasContext?: BlockAliasContext;
      }
    | {
        type: 'component';
        id: string;
        params?: Record<string, unknown>;
      }
  );

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
  /** Handles a close request. Call `close` to finish closing the popover. */
  onClose?: (close: () => void) => void;
};

export type PopoverSplitHandle = {
  close: () => void;
  isOpen: () => boolean;
  content: () => SplitContent;
  id: string;
};

export type ReferredFrom =
  | ListView
  | 'kommand-menu'
  | 'mention'
  | 'attachment'
  | 'launcher'
  | 'sidebar'
  | 'dock'
  | 'home'
  | 'entity-actions-menu'
  | 'hotkey'
  | 'quick-access'
  | 'file-upload'
  | 'fork'
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
  /** Shell components only; entity blocks are always single-instance. */
  allowDuplicate?: boolean;
  referredFrom: ReferredFrom;
  insertIndex?: number;
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
  /** Shell components only; entity blocks are always single-instance. */
  allowDuplicate?: boolean;
  replaceWhenFull?: boolean;
  /** If true, prefers opening in a new split. May still replace if layout is at capacity. */
  preferNewSplit?: boolean;
  insertIndex?: number;
  handle?: SplitHandle;
  /**
   * Ask the block to land on its latest content via the `goToLatest` block
   * method. Covers content that is already mounted (e.g. a channel open in
   * another split parked at an old scroll position), which would otherwise
   * just be activated as-is. Omit when navigating to a specific location
   * within the block.
   */
  reopen?: 'latest';
};

export type OpenSplitResult = {
  /** The source panel supplied by the caller, if any. */
  sourceOwner?: SplitId;
} & (
  | { status: 'opened'; split: SplitHandle }
  | { status: 'reused'; owner: ContentInstance['owner']; split?: SplitHandle }
  | { status: 'unavailable'; split?: undefined }
);

/** Return an outcome to consume navigation, or undefined to use normal split navigation. */
export type SplitNavigationInterceptor = (
  content: SplitContent,
  options: OpenWithSplitOptions
) => OpenSplitResult | undefined;

function keyOfSplitState(s: SplitState): SplitKey {
  return `${s.content.type}:${s.content.id}`;
}

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

export type OpenView = ContentInstance & {
  /** Present when this view is a top-level layout split, rather than an inline detail or popover. */
  topLevelSplit?: SplitHandle;
};

export type SplitManager = {
  /** Find the view owning this content without activating it. */
  findOpenView: (content: SplitContent) => OpenView | undefined;
  /** Register live inline views; call the returned function when the host is disposed. */
  registerOpenViews: (source: () => readonly ContentInstance[]) => () => void;
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

  /** Swap a split with its immediate neighbor in the requested direction. */
  swapSplit: (id: SplitId, direction: 'left' | 'right') => void;

  /** Whether a split group has a neighbor in the requested direction. */
  canSwapSplit: (id: SplitId, direction: 'left' | 'right') => boolean;

  /** Create a new split with the provided initial content and activate it */
  createNewSplit: (options: CreateNewSplitOptions) => SplitHandle | undefined;

  openWithSplit: (
    content: SplitContent,
    options?: OpenWithSplitOptions
  ) => OpenSplitResult;

  /** Set a split as active by its split id  */
  activateSplit: (id: SplitId) => void;

  spotlightSplit: (id: SplitId) => void;

  unSpotlightSplit: () => void;

  toggleSpotlightSplit: (id: SplitId) => void;

  getOrchestrator: () => BlockOrchestrator;

  canAppendSplit: () => boolean;

  /**
   * Reconcile the splits with the provided list of splits.
   * Useful when applying externally restored layout state.
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
    options?: { referredFrom?: ReferredFrom }
  ) => SplitHandle | undefined;

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
  createPopoverSplit: (
    options: PopoverSplitOptions
  ) => PopoverSplitHandle | undefined;

  /** Get all active popover splits */
  getActivePopovers: () => PopoverSplitHandle[];

  /** Close all popover splits */
  closeAllPopovers: () => void;

  /** Splits not excluded by the current exclusion filter, in order. */
  getVisibleSplits: () => SplitState[];

  /** Count of splits not excluded by the current exclusion filter. */
  getVisibleSplitCount: () => number;

  /**
   * Register a predicate that marks certain splits as excluded — excluded splits
   * are hidden from external serialization, duplicate detection, and content lookup.
   * Used for mobile swipe back behavior, where we want to ignore the bg split.
   */
  setExclusionFilter: (
    fn: ((split: SplitState) => boolean) | undefined
  ) => void;

  /**
   * Register an interceptor for new content and existing standalone splits.
   * If it returns `{ handled: true }` the normal split logic is skipped.
   */
  setSplitNavigationInterceptor: (
    fn: SplitNavigationInterceptor | undefined
  ) => void;

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
};

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
  /**
   * Point this split at a new id for the same mounted surface without remounting it.
   *
   * `replace` tears the mount down and builds a new one, which is right when
   * the user navigates somewhere else. This is the other case: the block is
   * already showing the right thing and only just learned what it is called.
   * The agent block opens on a client-minted placeholder and adopts its real
   * session id when the create resolves, with the composer the user is typing
   * into left untouched.
   *
   * Components may also adopt a resolved route id, as the Agents workspace does.
   * Only the id moves — same content type, same mount, same history entry
   * (rewritten in place, so Back still goes where it did and the URL swaps
   * without a new entry). A no-op unless the split currently shows content of
   * `type`.
   */
  adoptContentId: (options: {
    type: BlockName | 'component';
    nextId: string;
  }) => void;
  removeFromHistory: (predicate: (content: SplitContent) => boolean) => void;
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
  /**
   * Jump back to the nearest earlier history entry matching `predicate`,
   * skipping the entries in between. Entries whose content another split
   * already displays are skipped too, since this split cannot mount them.
   * Returns false — navigating nowhere — when no earlier entry qualifies.
   */
  goBackTo: (predicate: (content: SplitContent) => boolean) => boolean;
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
   * Immediately capture registered entry-state slices into the split's current
   * history entry. This is usually done implicitly on navigation, but here we offer
   * an explicit handle to trigger it manually, e.g. for mobile to manage it's split.
   */
  captureEntryState: () => void;
  /**
   * Read the `state` blob attached to this split's *current* history entry.
   * Returns `undefined` if no state has been captured.
   */
  currentEntryState: () => EntryState | undefined;
  /**
   * Replace the current history entry without remounting its content or
   * notifying content-identity listeners. Identity-changing updates are ignored.
   */
  updateCurrentEntry: (
    updater: (current: SplitContent) => SplitContent
  ) => void;
};

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

function contentIdentity(content: SplitContent) {
  const route =
    content.type === 'component' ? parseAgentsRoute(content.id) : undefined;
  return route
    ? {
        type:
          route.conversation.type === 'agent_session'
            ? ('agent' as const)
            : ('chat' as const),
        id: route.conversation.id,
      }
    : content;
}

function sameEntityContent(a: SplitContent, b: SplitContent): boolean {
  return sameContentIdentity(contentIdentity(a), contentIdentity(b));
}

function isDuplicateSplit(
  splits: SplitState[],
  content: SplitContent,
  isExcluded: (split: SplitState) => boolean = () => false
): boolean {
  return splits
    .filter((s) => !isExcluded(s))
    .some((split) => sameEntityContent(split.content, content));
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

  const contentInstances = createContentInstanceRegistry();
  const unregisterContentInstances = contentInstances.register(() => [
    ...state.splits.map((split) => ({
      owner: split.id,
      content: contentIdentity(split.content),
      activate: () => getSplit(split.id)?.activate(),
    })),
    ...[...state.popovers.values()]
      .filter((popover) => popover.isOpen)
      .map((popover) => ({
        owner: popover.id,
        content: contentIdentity(popover.content),
      })),
  ]);
  onCleanup(unregisterContentInstances);
  const canOpenContent = (content: SplitContent, owner?: SplitId) =>
    !contentInstances.isOpenElsewhere(contentIdentity(content), owner);

  /** Resolve an entity to its owning view, regardless of how that view renders it. */
  function findOpenView(content: SplitContent): OpenView | undefined {
    const identity = contentIdentity(content);
    const instance = contentInstances.find(identity);
    if (instance) {
      const split = state.splits.find((split) => split.id === instance.owner);
      return {
        ...instance,
        topLevelSplit: split ? getSplit(split.id) : undefined,
      };
    }

    // Shells have no entity identity; find them by their route instead.
    if (identity.type !== 'component') return;
    const split = getSplitByContent(content.type, content.id);
    if (split)
      return {
        owner: split.id,
        content: identity,
        activate: split.activate,
        topLevelSplit: split,
      };
  }

  const [resizeContext, setResizeContext] = createSignal<ResizeZoneCtx>();

  let exclusionFilter: ((split: SplitState) => boolean) | undefined;
  let splitNavigationInterceptor: SplitNavigationInterceptor | undefined;
  const isExcluded = (split: SplitState) => exclusionFilter?.(split) ?? false;

  const canAppendSplit = createMemo(
    () => resizeContext()?.canFit({ minSize: DEFAULT_SPLIT_MIN_WIDTH }) ?? true
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

    const state: EntryState = { ...(currentItem.state ?? {}) };
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

  function applyEntryMetadata(
    split: SplitState,
    desired: SplitContent
  ): SplitState {
    if (deepEqual(split.content.entryMetadata, desired.entryMetadata)) {
      return split;
    }

    const content = {
      ...split.content,
      entryMetadata: desired.entryMetadata,
    } as SplitContent;
    split.history.replaceCurrent(content);
    return { ...split, content };
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
    id?: SplitId;
    initialContent: SplitContent;
    isDefault?: boolean;
    referredFrom?: ReferredFrom;
    initialHistory?: SplitContent[];
  }): SplitState {
    const { initialContent, isDefault, referredFrom, initialHistory } = options;
    const id = options.id ?? newSplitId();
    const history = createHistory<SplitContent>({
      canVisit: (content) => canOpenContent(content, id),
    });
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

  /**
   * `deliverParams` marks a fresh forward navigation, which delivers the
   * one-shot `content.params` to the new mount. History-driven reattaches
   * (back/forward, removeFromHistory, reset) leave it unset so re-visiting an
   * entry doesn't re-fire its params (e.g. re-target a channel message).
   */
  function reattach(
    split: SplitState,
    next: SplitContent,
    referredFrom?: ReferredFrom,
    cause: NavigationCause = 'fresh',
    deliverParams = false
  ) {
    const otherSplits = state.splits.filter((s) => s.id !== split.id);
    let content = attachAliasContext(next);
    if (
      !deliverParams &&
      !content.preserveParams &&
      content.params !== undefined
    ) {
      content = { ...content, params: undefined };
    }
    if (isDuplicateSplit(otherSplits, next)) return;

    const splitIndex = splitIndexById(split.id);
    if (
      splitIndex >= 0 &&
      keyOfSplitContent(split.content) !== keyOfSplitContent(content)
    ) {
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

    if (keyOfSplitContent(split.content) === keyOfSplitContent(content)) {
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

    batch(() => {
      captureCurrentEntryState(split);

      const prev = split.history.back();
      if (!prev) return;

      reattach(split, prev, undefined, 'history-back');
    });
  }

  /**
   * Jump a split back to the nearest earlier history entry matching
   * `predicate`, skipping the entries in between (they stay reachable with
   * `forward`). Returns whether a match was found; the split is left untouched
   * when none is.
   */
  function backTo(
    id: SplitId,
    predicate: (content: SplitContent) => boolean
  ): boolean {
    const i = splitIndexById(id);
    if (i < 0) {
      console.error(`Split with id ${id} not found`);
      return false;
    }

    const split = state.splits[i];
    const result = { moved: false };

    batch(() => {
      captureCurrentEntryState(split);

      // Entries whose content another split already displays are not
      // candidates: `reattach` refuses them, which would strand the history
      // index on an entry the split never mounted. Skipping them here keeps
      // the index and the mounted content in step, and lets the search carry
      // on to an entry that can actually be shown.
      const prev = split.history.backTo(predicate);
      if (!prev) return;

      result.moved = true;
      reattach(split, prev, undefined, 'history-back');
    });

    return result.moved;
  }

  function forward(id: SplitId) {
    const i = splitIndexById(id);
    if (i < 0) return console.error(`Split with id ${id} not found`);

    const split = state.splits[i];
    if (!split.history.canGoForward()) return;

    batch(() => {
      captureCurrentEntryState(split);

      const next = split.history.forward();
      if (!next) return;

      reattach(split, next, undefined, 'history-forward');
    });
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
    if (!canOpenContent(content, id)) {
      openWithSplit(content);
      return;
    }

    const split = state.splits[i];
    batch(() => {
      captureCurrentEntryState(split);
      if (mergeHistory) {
        split.history.merge(content);
      } else {
        split.history.push(content);
      }

      reattach(
        split,
        content,
        referredFrom,
        mergeHistory ? 'replace' : 'fresh',
        true
      );
    });
  }

  /**
   * Move a split onto a new id for the block it is already showing, keeping
   * the mount. See `SplitHandle.adoptContentId` for why this exists.
   *
   * The history entry is rewritten rather than pushed, and the navigation
   * cause is `replace`, so external state can replace the id instead of adding
   * a back step to a placeholder the user can never return to.
   */
  function adoptContentId(
    id: SplitId,
    type: BlockName | 'component',
    nextId: string
  ) {
    const i = splitIndexById(id);
    if (i < 0) return;

    const split = state.splits[i];
    const current = split.content;
    if (current.type !== type || current.id === nextId) return;
    const next: SplitContent = { ...current, id: nextId, params: undefined };
    if (!canOpenContent(next, id)) {
      openWithSplit(next);
      return;
    }

    batch(() => {
      split.history.replaceCurrent(next);
      setState('splits', (splits) => {
        const index = splits.findIndex((s) => s.id === id);
        if (index < 0) return splits;
        const previous = splits[index];
        return splits.with(index, {
          ...previous,
          content: next,
          // The same mount, re-labelled: nothing unmounts here.
          mount:
            previous.mount.kind === 'block'
              ? { ...previous.mount, id: nextId }
              : previous.mount,
          lastNavigationCause: 'replace',
        });
      });
      if (type !== 'component') {
        orchestrator.rekeyBlockInstance(
          resolveBlockAlias(type),
          current.id,
          nextId
        );
      }
    });
  }

  function updateCurrentEntry(
    id: SplitId,
    updater: (current: SplitContent) => SplitContent
  ): void {
    const split = findSplitById(id);
    if (!split) return;
    if (
      split.history.index < 0 ||
      split.history.index >= split.history.items.length
    ) {
      return;
    }

    const current = split.content;
    const next = updater(current);
    if (
      next === current ||
      keyOfSplitContent(current) !== keyOfSplitContent(next)
    )
      return;

    batch(() => {
      split.history.replaceCurrent(next);
      setState('splits', (splits) => {
        const index = splits.findIndex((candidate) => candidate.id === id);
        if (index < 0) return splits;
        return splits.with(index, { ...splits[index], content: next });
      });
    });
  }

  function reset(id: SplitId) {
    const i = splitIndexById(id);
    if (i < 0) return console.error(`Split with id ${id} not found`);

    const history = createHistory<SplitContent>({
      canVisit: (content) => canOpenContent(content, id),
    });
    const content = attachAliasContext(DEFAULT_SPLIT_CONTENT);
    history.push(content);
    batch(() => {
      setState('splits', (splits) => splits.with(i, { ...splits[i], history }));
      reattach(state.splits[i], content, undefined, 'fresh');
    });
  }

  function activateSplit(id: SplitId) {
    // Invariant: an excluded split (the mobile background split) can never
    // become the active split. Promote it out of exclusion first.
    const split = findSplitById(id);
    if (split && isExcluded(split)) {
      if (import.meta.env.DEV) {
        console.warn(
          `activateSplit: refusing to activate excluded split ${id}`
        );
      }
      return;
    }
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
      // Re-resolve the split by id rather than reading the captured
      // `currentSplit`. reconcileSplits can replace the SplitState (fresh
      // history, same id) while this handle instance persists, so the captured
      // reference goes stale and the button would report the old history.
      canGoBack: () =>
        (findSplitById(currentSplit.id) ?? currentSplit).history.canGoBack(),
      canGoForward: () =>
        (findSplitById(currentSplit.id) ?? currentSplit).history.canGoForward(),
      goBack: () => back(currentSplit.id),
      goBackTo: (predicate: (content: SplitContent) => boolean) =>
        backTo(currentSplit.id, predicate),
      reset: () => reset(currentSplit.id),
      goForward: () => forward(currentSplit.id),
      replace: ({ next, mergeHistory = false, referredFrom }) =>
        replace(currentSplit.id, { next, mergeHistory, referredFrom }),
      adoptContentId: ({ type, nextId }) =>
        adoptContentId(currentSplit.id, type, nextId),
      removeFromHistory: (predicate: (content: SplitContent) => boolean) => {
        removeFromHistory(currentSplit.id, predicate);
      },
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
          if (
            keyOfSplitContent(content()) !==
            keyOfSplitContent(DEFAULT_SPLIT_CONTENT)
          )
            replace(currentSplit.id, {
              next: DEFAULT_SPLIT_CONTENT,
              referredFrom: null,
            });

          return;
        }

        removeSplit(currentSplit.id);
      },
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
      meta: () => {
        const mount = findSplitById(currentSplit.id)?.mount;
        return mount?.kind === 'component' ? mount.meta : undefined;
      },
      get updateMeta() {
        const mount = findSplitById(currentSplit.id)?.mount;
        return mount?.kind === 'component' ? mount.updateMeta : undefined;
      },
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
      captureEntryState: () => {
        const live = s();
        if (!live) return;
        captureCurrentEntryState(live);
      },
      currentEntryState: () => {
        const live = s();
        if (!live) return undefined;
        // Read through the store getter so callers see the latest captured
        // state (mirrored from history into split.content on capture).
        const c = live.content as { state?: EntryState };
        return c.state;
      },
      updateCurrentEntry: (updater) =>
        updateCurrentEntry(currentSplit.id, updater),
    };
  };

  function createNewSplit(
    options: CreateNewSplitOptions
  ): SplitHandle | undefined {
    const { content, activate, referredFrom, initialHistory, insertIndex } =
      options;
    const initialContent = content ?? DEFAULT_SPLIT_CONTENT;
    const isDefault =
      keyOfSplitContent(initialContent) ===
      keyOfSplitContent(DEFAULT_SPLIT_CONTENT);

    // Direct split creation permits duplicate shells, but never duplicate entities.
    const existing = findOpenView(initialContent);
    if (existing && existing.content.type !== 'component') {
      if (activate) existing.activate?.();
      return existing.topLevelSplit;
    }
    const split = buildSplit({
      initialContent,
      isDefault,
      referredFrom,
      initialHistory,
    });

    batch(() => {
      setState('splits', (previousSplits) => {
        if (insertIndex === undefined) return [...previousSplits, split];

        const nextSplits = [...previousSplits];
        nextSplits.splice(
          Math.max(0, Math.min(insertIndex, nextSplits.length)),
          0,
          split
        );
        return nextSplits;
      });
    });

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

    batch(() => {
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
    });
  }

  function canSwapSplit(id: SplitId, direction: 'left' | 'right') {
    const index = splitIndexById(id);
    const target = index + (direction === 'left' ? -1 : 1);
    return index >= 0 && target >= 0 && target < state.splits.length;
  }

  function swapSplit(id: SplitId, direction: 'left' | 'right') {
    if (!canSwapSplit(id, direction)) return;
    const index = splitIndexById(id);
    const targetIndex = index + (direction === 'left' ? -1 : 1);
    const target = state.splits[targetIndex];
    batch(() => {
      resizeContext()?.swap(id, target.id);
      setState('splits', (splits) =>
        splits.with(index, splits[targetIndex]).with(targetIndex, splits[index])
      );
    });
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
    const instance = contentInstances.find(contentIdentity({ type, id }));
    const match = state.splits.find(
      (s) =>
        (s.id === instance?.owner ||
          (s.content.type === type && s.content.id === id)) &&
        !isExcluded(s)
    );
    if (!match) return;
    return getSplit(match.id);
  }

  function reconcileEntryMetadata(
    visibleSplits: SplitState[],
    newSplits: SplitContent[]
  ) {
    const metadataChanged = visibleSplits.some(
      (split, index) =>
        !deepEqual(split.content.entryMetadata, newSplits[index]?.entryMetadata)
    );
    if (!metadataChanged) return;

    setState('splits', (splits) => {
      const nextById = new Map(
        visibleSplits.map((split, index) => [
          split.id,
          applyEntryMetadata(split, newSplits[index]),
        ])
      );
      return splits.map((split) => nextById.get(split.id) ?? split);
    });
  }

  function reconcileSplits(newSplits: SplitContent[]) {
    const visibleSplits = state.splits.filter((s) => !isExcluded(s));
    const currentKeys = visibleSplits.map(keyOfSplitState);
    const newKeys = newSplits.map(keyOfSplitContent);
    const changed = newKeys.join(',') !== currentKeys.join(',');

    if (!changed) {
      reconcileEntryMetadata(visibleSplits, newSplits);
      return;
    }

    // Build the result array by position, preserving excluded splits unchanged.
    const resultSplits: SplitState[] = [];
    const usedIds = new Set<SplitId>();

    for (const split of state.splits) {
      if (isExcluded(split)) {
        resultSplits.push(split);
        usedIds.add(split.id);
      }
    }

    // Assign existing splits before creating replacements. Matching by content
    // after the same-position fast path lets a split keep its identity (and its
    // history/mount) when inbound state merely moves it to another index.
    const assignments = new Array<SplitState | undefined>(newSplits.length);

    for (let i = 0; i < newSplits.length; i++) {
      const newContent = newSplits[i];
      const splitAtSameIndex = visibleSplits[i];

      if (
        splitAtSameIndex &&
        !usedIds.has(splitAtSameIndex.id) &&
        keyOfSplitContent(splitAtSameIndex.content) ===
          keyOfSplitContent(newContent)
      ) {
        assignments[i] = splitAtSameIndex;
        usedIds.add(splitAtSameIndex.id);
      }
    }

    for (let i = 0; i < newSplits.length; i++) {
      if (assignments[i]) continue;

      const existing = visibleSplits.find(
        (split) =>
          !usedIds.has(split.id) &&
          keyOfSplitContent(split.content) === keyOfSplitContent(newSplits[i])
      );
      if (existing) {
        assignments[i] = existing;
        usedIds.add(existing.id);
      }
    }

    for (let i = 0; i < newSplits.length; i++) {
      const existing = assignments[i];
      if (existing) {
        resultSplits.push(applyEntryMetadata(existing, newSplits[i]));
        continue;
      }

      if (
        isDuplicateSplit(resultSplits, newSplits[i]) ||
        !canOpenContent(newSplits[i])
      ) {
        const previous = visibleSplits[i];
        if (previous && !usedIds.has(previous.id)) {
          resultSplits.push(previous);
          usedIds.add(previous.id);
        }
        continue;
      }
      const splitAtSameIndex = visibleSplits[i];
      // A true replacement can retain the slot's ID, but never steal an ID
      // already assigned to content that moved elsewhere. Choose it before
      // building the history so its availability rule excludes the right owner.
      const retainedId =
        splitAtSameIndex && !usedIds.has(splitAtSameIndex.id)
          ? splitAtSameIndex.id
          : undefined;
      const newSplit = buildSplit({
        id: retainedId,
        initialContent: newSplits[i],
        referredFrom: null,
      });

      if (retainedId) {
        setSplitNamesById(
          produce((map) => {
            delete map[retainedId];
            return map;
          })
        );
      }

      usedIds.add(newSplit.id);
      resultSplits.push(newSplit);
    }

    // Update the layout and clean up removed splits atomically.
    batch(() => {
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

      setState('splits', resultSplits);
    });
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
  ): PopoverSplitHandle | undefined {
    if (!canOpenContent(options.content)) {
      openWithSplit(options.content);
      return;
    }
    const id = `popover-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Acquire focus lock BEFORE any state updates to capture the correct element
    const focusLock = useFocusLock(`popover-${id}`);
    focusLock.acquire();

    const mount = createPinnedMount(orchestrator, options.content);
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;

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
    };

    const handle: PopoverSplitHandle = {
      id,
      close: () => {
        if (closed) return;
        if (options.onClose) {
          options.onClose(close);
          return;
        }
        close();
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
  ): OpenSplitResult {
    const sourceOwner = options.handle?.id;
    const existing = findOpenView(content);

    if (options.reopen === 'latest') {
      // Fire-and-forget so it covers every open path (fresh mount, duplicate
      // activation, interceptor-consumed navigation). The block-handle proxy
      // waits for the block and method to register before invoking.
      void orchestrator
        .getBlockHandle(content.id)
        .then((handle) => handle?.goToLatest())
        .catch((e) => console.error('openWithSplit: goToLatest failed', e));
    }

    // Mobile navigation handles new content and promotes existing top-level
    // splits.
    if (splitNavigationInterceptor && (!existing || existing.topLevelSplit)) {
      const result = splitNavigationInterceptor(content, options);
      if (result) return { ...result, sourceOwner };
    }

    // Entity views are always reused; only shell components may be duplicated.
    const canDuplicateShell =
      options.allowDuplicate && existing?.content.type === 'component';

    if (existing && !canDuplicateShell) {
      const existingSplit = existing.topLevelSplit;
      // Preserve per-entry state when the owning split replaces its current entry.
      if (
        existingSplit &&
        options.mergeHistory &&
        options.handle?.id === existingSplit.id
      ) {
        existingSplit.captureEntryState();
        const currentState = existingSplit.currentEntryState();
        const nextContent =
          currentState || content.state
            ? {
                ...content,
                state: { ...currentState, ...content.state },
              }
            : content;
        existingSplit.replace({
          next: nextContent,
          referredFrom: options.referredFrom ?? null,
          mergeHistory: true,
        });
      }

      if (options.activate !== false) existing.activate?.();
      return {
        status: 'reused',
        owner: existing.owner,
        split: existingSplit,
        sourceOwner,
      };
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

      return { status: 'opened', split: splitHandle, sourceOwner };
    } else {
      const split = createNewSplit({
        content,
        activate: options.activate ?? true,
        referredFrom: options.referredFrom ?? null,
        allowDuplicate: options.allowDuplicate,
        insertIndex: options.insertIndex,
      });
      return split
        ? { status: 'opened', split, sourceOwner }
        : { status: 'unavailable', sourceOwner };
    }
  }

  function replaceAllSplits(
    content: SplitContent,
    options: { referredFrom?: ReferredFrom } = {}
  ): SplitHandle | undefined {
    if (
      !canOpenContent(content, getSplitByContent(content.type, content.id)?.id)
    ) {
      openWithSplit(content);
      return;
    }
    const visibleSplits = state.splits.filter((split) => !isExcluded(split));
    const splitToKeep =
      visibleSplits.find(
        (split) =>
          keyOfSplitContent(split.content) === keyOfSplitContent(content)
      ) ?? visibleSplits[0];

    if (!splitToKeep) {
      return createNewSplit({
        content,
        activate: true,
        referredFrom: options.referredFrom ?? null,
      });
    }

    // Atomic for the same reason as SplitHandle.close: no flush between
    // removals, so observers only see the final layout.
    batch(() => {
      for (const split of visibleSplits) {
        if (split.id !== splitToKeep.id) {
          removeSplit(split.id, false);
        }
      }
    });

    const handle = getSplit(splitToKeep.id);
    if (handle) {
      if (
        keyOfSplitContent(splitToKeep.content) !== keyOfSplitContent(content)
      ) {
        handle.replace({
          next: content,
          mergeHistory: false,
          referredFrom: options.referredFrom,
        });
      }
      handle.activate();
      unSpotlightSplit();
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

  const getVisibleSplits = () => state.splits.filter((s) => !isExcluded(s));

  return {
    splits: () => state.splits,
    findOpenView,
    registerOpenViews: contentInstances.register,
    activeSplitId: () => state.activeSplitId,
    activeSplit,
    lastActiveSplitId: () => state.lastActiveSplitId,
    events: lastEvent,
    reconcile: reconcileSplits,
    replaceAllSplits,
    getSplit,
    openWithSplit,
    removeSplit,
    swapSplit,
    canSwapSplit,
    createNewSplit,
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
    getVisibleSplits,
    getVisibleSplitCount: () => getVisibleSplits().length,
    setExclusionFilter: (fn) => {
      exclusionFilter = fn;
    },
    setSplitNavigationInterceptor: (fn) => {
      splitNavigationInterceptor = fn;
    },
  };
}
