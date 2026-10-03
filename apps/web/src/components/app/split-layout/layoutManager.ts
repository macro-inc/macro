import { LIST_VIEW_ID, type ListView } from '@app/constants/list-views';
import { parseAgentsRoute } from '@app/features/agents-view/core/route';
import type {
  Entry,
  NavigationResult,
  PaneArrival,
  PaneId,
  SplitLocation,
  SplitNavigateOptions,
  SplitRouter,
  SplitSearchUpdate,
} from '@app/split-router';
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
  batch,
  createComputed,
  createMemo,
  createSignal,
  type JSXElement,
  mapArray,
  onCleanup,
  untrack,
} from 'solid-js';
import { createStore, produce, type Store } from 'solid-js/store';
import {
  type ComponentMeta,
  type ComponentMetaMap,
  resolveComponent,
} from './componentRegistry';
import { contentReference } from './content-reference';
import {
  type ContentInstance,
  createContentInstanceRegistry,
} from './contentInstanceRegistry';
import { DEFAULT_SPLIT_MIN_WIDTH } from './splitContentSizing';

/** Checked on every route change in a pane, so entry state is captured before the pane moves. */
const ENTRY_STATE_GUARD_DEPTH = Number.MAX_SAFE_INTEGER;

type MaybePromise<T> = T | Promise<T>;

async function settleNavigation(
  result: Promise<NavigationResult>,
  then: (outcome: NavigationResult) => void
) {
  then(await result);
}

/** Runs `then` once a router navigation settles, right away when it already has. */
function afterNavigation(
  result: MaybePromise<NavigationResult>,
  then: (outcome: NavigationResult) => void
): void {
  if (result instanceof Promise) {
    void settleNavigation(result, then);
    return;
  }

  then(result);
}

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
  content: SplitContent; // mirror of the pane's current router entry
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
};

export type OpenWithSplitOptions = {
  /** Route-owned targets must pass through middleware and content claims before opening. */
  search?: Record<string, SplitSearchUpdate>;
  /** Runs after a cooperating navigator applies or reuses its destination. */
  onApplied?: () => void;
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
  | { status: 'navigating'; split?: undefined }
);

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

export type SplitLayoutOptions = {
  router: SplitRouter;
  /** Where content lives in the router's route table. */
  toLocation: (content: SplitContent) => SplitLocation;
  /** The content a router location shows. */
  toContent: (location: SplitLocation) => SplitContent;
  defaultSplitContent?: SplitContent;
  /**
   * Panes stack and only the front one shows, as on native mobile. Opens
   * add a pane in front unless they merge history, and activating a pane
   * behind moves it to the front.
   */
  stacked?: () => boolean;
};

export type SplitManager = {
  /** Whether the router has loaded the URL, so route-owned opens can run. */
  readonly contentNavigationReady: Accessor<boolean>;
  /** Changes when route-owned navigation becomes available. */
  readonly contentNavigationVersion: Accessor<number>;
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

  /** Splits on screen, in order; stacked panes show only the front one. */
  getVisibleSplits: () => SplitState[];

  /** Count of splits on screen. */
  getVisibleSplitCount: () => number;

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

export function createSplitLayout(
  orchestrator: BlockOrchestrator,
  options: SplitLayoutOptions
): SplitManager {
  const { router, toLocation, toContent, defaultSplitContent } = options;
  const stacked = () => options.stacked?.() ?? false;
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

  const isFront = (id: SplitId) => state.splits.at(-1)?.id === id;
  const onScreen = (split: SplitState) => !stacked() || isFront(split.id);

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
   * component-owned state slice. Right before a pane leaves its current
   * entry, we invoke all captors for that split and keep the resulting blob
   * for that router entry, so returning to it restores the slices.
   */
  const entryStateCaptors = new Map<SplitId, Map<string, () => unknown>>();
  const entryStates = new Map<string, EntryState>();

  const paneOf = (id: SplitId) => id as string as PaneId;
  const splitOf = (pane: PaneId) => pane as string as SplitId;

  function captureEntry(id: SplitId, entry: Entry): EntryState | undefined {
    const captors = entryStateCaptors.get(id);
    if (!captors || captors.size === 0) return;

    const state: EntryState = { ...entryStates.get(entry.id) };
    for (const [key, getter] of captors) {
      try {
        state[key] = getter();
      } catch (err) {
        console.error(
          `Entry state captor for split ${id} key "${key}" threw`,
          err
        );
      }
    }
    entryStates.set(entry.id, state);

    return state;
  }

  function captureCurrentEntryState(split: SplitState): void {
    const entry = untrack(() => router.entry(paneOf(split.id)));
    if (!entry) return;

    const state = captureEntry(split.id, entry);
    if (!state) return;

    // Mirror onto SplitState.content so live reads see the captured state.
    setState('splits', (s) => {
      const i = s.findIndex((x) => x.id === split.id);
      if (i < 0) return s;
      return s.with(i, { ...s[i], content: { ...s[i].content, state } });
    });
  }

  const DEFAULT_SPLIT_CONTENT = defaultSplitContent ?? {
    type: 'component',
    id: LIST_VIEW_ID.home,
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

  /**
   * The content a router entry shows. A fresh visit or replace delivers the
   * entry's one-shot props as `params`; history traversal does not, unless the
   * entry keeps them.
   */
  function contentOfEntry(entry: Entry, deliverParams: boolean): SplitContent {
    const routed = toContent(entry.location);
    const delivers = deliverParams || entry.keepProps === true;
    const params = delivers ? entry.props : undefined;
    const state = entryStates.get(entry.id);
    const content = {
      ...routed,
      ...(params !== undefined && { params }),
      ...(entry.keepProps && { preserveParams: true }),
      ...(state && { state }),
      entryMetadata: entry.location,
    } as SplitContent;

    return attachAliasContext(content);
  }

  function contentAt(entry: Entry): SplitContent {
    return contentOfEntry(entry, false);
  }

  const causeOf = (arrival: PaneArrival): NavigationCause => {
    if (arrival === 'back') return 'history-back';
    if (arrival === 'forward') return 'history-forward';
    if (arrival === 'replace') return 'replace';

    return 'fresh';
  };

  function newSplitState(
    id: SplitId,
    content: SplitContent,
    referredFrom: ReferredFrom | undefined
  ): SplitState {
    return {
      id,
      content,
      mount: createPinnedMount(orchestrator, content),
      referredFrom: referredFrom ?? null,
      lastNavigationCause: 'fresh',
    };
  }

  /** Shows `content`, the pane's new current entry, in `split`; a new identity remounts. */
  function reattach(
    split: SplitState,
    content: SplitContent,
    referredFrom: ReferredFrom | undefined,
    cause: NavigationCause
  ) {
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

  /** How the manager reached an entry; kept on the router entry, in memory only. */
  type EntryMeta = {
    referredFrom?: ReferredFrom;
    activate?: boolean;
    entryState?: EntryState;
  };

  const metaOf = (entry: Entry) => (entry.meta ?? {}) as EntryMeta;

  function entryOptionsOf(
    content: SplitContent,
    meta: EntryMeta = {}
  ): SplitNavigateOptions {
    const entryMeta: EntryMeta = {
      ...meta,
      ...(content.state && { entryState: content.state }),
    };

    return {
      props: content.params,
      keepProps: content.preserveParams,
      meta: entryMeta,
    };
  }

  /** Splits whose next entry relabels the mount instead of remounting it. */
  const pendingAdoptions = new Set<SplitId>();

  function navigateSplit(
    id: SplitId,
    content: SplitContent,
    navigateOptions: { replace?: boolean; referredFrom?: ReferredFrom } = {}
  ): MaybePromise<NavigationResult> {
    const { replace, referredFrom } = navigateOptions;
    const target = { location: toLocation(content) };

    return router.navigatePane(paneOf(id), target, {
      ...entryOptionsOf(content, { referredFrom }),
      replace,
    });
  }

  function back(id: SplitId) {
    void router.navigatePane(paneOf(id), -1);
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
    const result = router.goBackTo(paneOf(id), (entry) =>
      predicate(contentAt(entry))
    );
    if (result instanceof Promise) return true;

    return result;
  }

  function forward(id: SplitId) {
    void router.navigatePane(paneOf(id), 1);
  }

  function removeFromHistory(
    id: SplitId,
    predicate: (content: SplitContent) => boolean
  ) {
    void router.removeEntries(paneOf(id), (entry) =>
      predicate(contentAt(entry))
    );
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
    if (!findSplitById(id))
      return console.error(`Split with id ${id} not found`);

    const content = attachAliasContext(next);
    if (!canOpenContent(content, id)) {
      openWithSplit(content);
      return;
    }

    void navigateSplit(id, content, { replace: mergeHistory, referredFrom });
  }

  /**
   * Move a split onto a new id for the block it is already showing, keeping
   * the mount. See `SplitHandle.adoptContentId` for why this exists.
   *
   * The current entry is rewritten rather than pushed, so external state can
   * replace the id instead of adding a back step to a placeholder the user can
   * never return to.
   */
  function adoptContentId(
    id: SplitId,
    type: BlockName | 'component',
    nextId: string
  ) {
    const split = findSplitById(id);
    if (!split) return;

    const current = split.content;
    if (current.type !== type || current.id === nextId) return;
    const next: SplitContent = { ...current, id: nextId, params: undefined };
    if (!canOpenContent(next, id)) {
      openWithSplit(next);
      return;
    }

    pendingAdoptions.add(id);
    const result = router.rewriteCurrent(paneOf(id), {
      location: toLocation(next),
    });
    afterNavigation(result, () => pendingAdoptions.delete(id));
  }

  /** Relabels the mount for an adopted id: the same surface, nothing unmounts. */
  function adoptMount(split: SplitState, next: SplitContent) {
    const current = split.content;

    batch(() => {
      setState('splits', (splits) => {
        const index = splits.findIndex((s) => s.id === split.id);
        if (index < 0) return splits;
        const previous = splits[index];
        return splits.with(index, {
          ...previous,
          content: next,
          mount:
            previous.mount.kind === 'block'
              ? { ...previous.mount, id: next.id }
              : previous.mount,
          lastNavigationCause: 'replace',
        });
      });
      if (current.type !== 'component') {
        orchestrator.rekeyBlockInstance(
          resolveBlockAlias(current.type),
          current.id,
          next.id
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

    const current = split.content;
    const next = updater(current);
    const sameIdentity = keyOfSplitContent(current) === keyOfSplitContent(next);
    if (next === current || !sameIdentity) return;

    const entry = untrack(() => router.entry(paneOf(id)));
    if (entry && next.state) entryStates.set(entry.id, next.state);

    void router.rewriteCurrent(paneOf(id), { location: toLocation(next) });
  }

  function reset(id: SplitId) {
    if (!findSplitById(id))
      return console.error(`Split with id ${id} not found`);

    void navigateSplit(id, DEFAULT_SPLIT_CONTENT);
  }

  /** Mirrors a pane's new current entry onto its split, creating the split when the pane is new. */
  function applyEntry(id: SplitId, entry: Entry, arrival: PaneArrival) {
    const deliversParams = arrival === 'fresh' || arrival === 'replace';
    const content = contentOfEntry(entry, deliversParams);
    const meta = metaOf(entry);
    const referredFrom = deliversParams ? meta.referredFrom : undefined;
    const split = findSplitById(id);

    if (!split) {
      addSplit(id, content, referredFrom, meta.activate ?? true);
      return;
    }

    if (pendingAdoptions.has(id)) {
      pendingAdoptions.delete(id);
      adoptMount(split, content);
      return;
    }

    reattach(split, content, referredFrom, causeOf(arrival));
  }

  function addSplit(
    id: SplitId,
    content: SplitContent,
    referredFrom: ReferredFrom | undefined,
    activate: boolean
  ) {
    const split = newSplitState(id, content, referredFrom);

    batch(() => {
      setState('splits', (splits) => [...splits, split]);
      if (activate) activateSplit(id);
      dispatchEvent(SplitEvent.Insert, {
        splitId: id,
        activate,
        initial: content,
      });
    });
  }

  /** Forgets a split whose pane the router removed. */
  function dropSplit(id: SplitId) {
    const index = splitIndexById(id);
    if (index < 0) return;

    contentChangeListeners.delete(id);
    entryStateCaptors.delete(id);

    batch(() => {
      setSplitNamesById(
        produce((map) => {
          delete map[id];
          return map;
        })
      );
      setState('splits', (splits) => splits.filter((s) => s.id !== id));
      const front = state.splits.at(-1);
      if (stacked() && state.activeSplitId === id && front) {
        setState('activeSplitId', front.id);
      }
      dispatchEvent(SplitEvent.Remove, { splitId: id, splitIndex: index });
    });
  }

  /** Puts splits in the router's pane order. */
  function orderSplits(ids: readonly SplitId[]) {
    const byId = new Map(state.splits.map((split) => [split.id, split]));
    const ordered = ids.flatMap((id) => byId.get(id) ?? []);
    const inOrder =
      ordered.length === state.splits.length &&
      ordered.every((split, index) => split === state.splits[index]);
    if (inOrder) return;

    setState('splits', ordered);
  }

  function activateSplit(id: SplitId) {
    if (stacked() && !isFront(id)) {
      bringToFront(id);
      return;
    }

    const current = state.activeSplitId;
    setState('lastActiveSplitId', current);
    if (state.spotlightId && state.spotlightId !== id) {
      setState('spotlightId', undefined);
    }
    setState('activeSplitId', id);
  }

  /** Stacked panes bring a pane behind the front forward; the panes that were in front of it stay, behind it. */
  function bringToFront(id: SplitId) {
    if (splitIndexById(id) < 0) return;

    router.move(paneOf(id), state.splits.length - 1);
    activateSplit(id);
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
      canGoBack: () => router.canGo(paneOf(currentSplit.id), -1),
      canGoForward: () => router.canGo(paneOf(currentSplit.id), 1),
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
        const snapshot = router.history(paneOf(currentSplit.id));
        if (!snapshot || snapshot.index <= 0) return null;

        const previous = snapshot.entries[snapshot.index - 1];
        return previous ? contentAt(previous) : null;
      },
      history: () => {
        const snapshot = router.history(paneOf(currentSplit.id));
        if (!snapshot) return [];

        return snapshot.entries.slice(0, snapshot.index + 1).map(contentAt);
      },
      close: () => {
        void router.close(paneOf(currentSplit.id));
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
        // Untracked so a render effect that writes layout does not re-run when
        // the split's mount changes and stamp the previous view onto the next.
        const mount = untrack(() => findSplitById(currentSplit.id)?.mount);
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

  /** Opens `content` in a new pane where the policy places it, after the active split by default. */
  function openPane(
    content: SplitContent,
    openOptions: {
      insertIndex?: number;
      referredFrom?: ReferredFrom;
      activate?: boolean;
      allowDuplicate?: boolean;
    }
  ): MaybePromise<NavigationResult> {
    const { insertIndex, referredFrom, activate, allowDuplicate } = openOptions;
    const active = state.activeSplitId;
    const source = active ? paneOf(active) : undefined;

    return router.open(
      { location: toLocation(content) },
      { newPane: true, source, intent: { insertIndex, direct: true } },
      {
        ...entryOptionsOf(content, { referredFrom, activate }),
        allowDuplicate,
      }
    );
  }

  function createNewSplit(
    options: CreateNewSplitOptions
  ): SplitHandle | undefined {
    const { content, activate, referredFrom, insertIndex, allowDuplicate } =
      options;
    const initialContent = attachAliasContext(content ?? DEFAULT_SPLIT_CONTENT);

    // Direct split creation permits duplicate shells, but never duplicate entities.
    const existing = findOpenView(initialContent);
    if (existing && existing.content.type !== 'component') {
      if (activate) existing.activate?.();
      return existing.topLevelSplit;
    }

    const result = openPane(initialContent, {
      insertIndex,
      referredFrom,
      activate: activate ?? false,
      allowDuplicate,
    });
    if (result instanceof Promise) return;
    if (result.status !== 'committed') return;

    return getSplit(splitOf(result.pane));
  }

  /** Removes a split; the last one shows the default content instead. */
  function removeSplit(id: SplitId, createNewOnEmpty: boolean = true) {
    if (!findSplitById(id)) return;

    const isLast = state.splits.length <= 1;
    if (isLast) {
      if (createNewOnEmpty) void navigateSplit(id, DEFAULT_SPLIT_CONTENT);
      return;
    }

    void router.remove(paneOf(id));
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
      router.move(paneOf(id), targetIndex);
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
    const instance = contentInstances.find(
      contentIdentity(contentReference(type, id))
    );
    const match = state.splits.find(
      (s) =>
        s.id === instance?.owner ||
        (s.content.type === type && s.content.id === id)
    );
    if (!match) return;
    return getSplit(match.id);
  }

  // The router owns each pane's history; splits mirror what its panes show.
  const paneSplits = mapArray(router.panes, (pane) => {
    const id = splitOf(pane);

    createComputed(() => {
      const entry = router.entry(pane);
      const arrival = router.arrival(pane);
      if (!entry) return;

      untrack(() => applyEntry(id, entry, arrival));
    });

    const unregisterGuard = router.registerGuard(
      pane,
      ENTRY_STATE_GUARD_DEPTH,
      ({ from }) => {
        captureEntry(id, from);
        return true;
      }
    );

    onCleanup(() => {
      unregisterGuard();
      untrack(() => dropSplit(id));
    });

    return id;
  });

  createComputed(() => {
    const ids = paneSplits();
    untrack(() => orderSplits(ids));
  });

  const lastEvent = createMemo(() => state.events[state.events.length - 1]);

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

  /** An open that carries search: the router merges it and checks claims as it lands. */
  function openThroughRouter(
    content: SplitContent,
    options: OpenWithSplitOptions
  ) {
    const firstVisible = getVisibleSplits()[0];
    const source =
      options.handle ??
      activeSplit() ??
      (firstVisible ? getSplit(firstVisible.id) : undefined);
    const target = { location: toLocation(content) };
    const navigateOptions = {
      ...entryOptionsOf(content, {
        referredFrom: options.referredFrom ?? null,
      }),
      replace: options.mergeHistory,
      search: options.search,
      allowDuplicate: options.allowDuplicate,
    };
    const wantsNewPane = stacked()
      ? !options.mergeHistory
      : options.preferNewSplit === true && canAppendSplit();

    const result =
      !source || wantsNewPane
        ? router.open(
            target,
            {
              newPane: true,
              source: source && paneOf(source.id),
              intent: { insertIndex: options.insertIndex, direct: true },
            },
            navigateOptions
          )
        : router.navigatePane(paneOf(source.id), target, navigateOptions);

    afterNavigation(result, (outcome) => {
      const applied = outcome.status !== 'cancelled';
      if (applied) options.onApplied?.();
    });
  }

  function openWithSplit(
    content: SplitContent,
    options: OpenWithSplitOptions = {}
  ): OpenSplitResult {
    const sourceOwner = options.handle?.id;
    if (options.search) {
      openThroughRouter(content, options);
      return { status: 'navigating', sourceOwner };
    }
    const existing = findOpenView(content);

    if (options.reopen === 'latest') {
      // Fire-and-forget so it covers every open path (fresh mount or
      // duplicate activation). The block-handle proxy waits for the block
      // and method to register before invoking.
      void orchestrator
        .getBlockHandle(content.id)
        .then((handle) => handle?.goToLatest())
        .catch((e) => console.error('openWithSplit: goToLatest failed', e));
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

    const shouldReplace = stacked()
      ? options.mergeHistory === true
      : !options.preferNewSplit || shouldReplaceWhenFull;

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

  /** Shows `content` as the only split, in one navigation; a split already showing it stays. */
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

    const result = router.navigate(
      { location: toLocation(content) },
      entryOptionsOf(content, {
        referredFrom: options.referredFrom ?? null,
        activate: true,
      })
    );
    const showAlone = (outcome: NavigationResult) => {
      if (outcome.status !== 'committed') return;

      activateSplit(splitOf(outcome.pane));
      unSpotlightSplit();
    };

    if (result instanceof Promise) {
      void settleNavigation(result, showAlone);
      return;
    }

    showAlone(result);
    if (result.status !== 'committed') return;

    return getSplit(splitOf(result.pane));
  }

  const activeSplit = () => {
    const id = state.activeSplitId;
    return id ? getSplit(id) : undefined;
  };

  const getVisibleSplits = () => state.splits.filter(onScreen);

  return {
    splits: () => state.splits,
    findOpenView,
    registerOpenViews: contentInstances.register,
    activeSplitId: () => state.activeSplitId,
    activeSplit,
    lastActiveSplitId: () => state.lastActiveSplitId,
    events: lastEvent,
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
    contentNavigationReady: router.ready,
    contentNavigationVersion: () => (router.ready() ? 1 : 0),
  };
}
