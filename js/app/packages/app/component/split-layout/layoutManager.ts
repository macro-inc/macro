import type {
  BlockAlias,
  BlockAliasContext,
  BlockComponentProps,
  BlockName,
} from '@core/block';
import { useFocusLock } from '@core/util/createControlledOpenSignal';
import type { ResizeZoneCtx } from '@core/component/Resize/types';
import { isBlockAlias, resolveBlockAlias } from '@core/constant/allBlocks';
import type {
  BlockInstanceHandle,
  BlockOrchestrator,
} from '@core/orchestrator';
import { isSettingsPanelOpen } from '@core/signal/layout';
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

const ENABLE_DEFAULT_ALWAYS_IN_HISTORY = true;

export type SplitId = string & { readonly SplitId: unique symbol };
type SplitKey = `${BlockName | BlockAlias | 'component'}:${string}`;

export type SplitContent =
  | {
      type: BlockName | BlockAlias;
      id: string;
      params?: BlockComponentProps[BlockName];
      aliasContext?: BlockAliasContext;
    }
  | {
      type: 'component';
      id: string;
      params?: Record<string, string>;
    };

export type SplitContentType = SplitContent['type'];

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
  | 'unified-list'
  | 'kommand-menu'
  | 'mention'
  | 'attachment'
  | 'launcher'
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
};

export type CreateNewSplitOptions = {
  content?: SplitContent;
  activate?: boolean;
  referredFrom: ReferredFrom;
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
  ) => SplitHandle;

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
  id: SplitId;
  /** Component metadata store (only available for component splits) */
  meta: () => Store<TMeta> | undefined;
  /** Update component metadata (only available for component splits) */
  updateMeta: ((data: Omit<TMeta, 'kind'>) => void) | undefined;
  referredFrom: () => ReferredFrom;
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

  function buildSplit(options: {
    initialContent: SplitContent;
    isDefault?: boolean;
    referredFrom?: ReferredFrom;
  }): SplitState {
    const { initialContent, isDefault, referredFrom } = options;
    const id = newSplitId();
    const history = createHistory<SplitContent>();
    const content = attachAliasContext(initialContent);

    // If enabled, we always want to be able to go back to the default split
    if (!isDefault && ENABLE_DEFAULT_ALWAYS_IN_HISTORY) {
      history.push(DEFAULT_SPLIT_CONTENT);
    }

    history.push(content);
    const mount = createPinnedMount(orchestrator, content);

    return {
      id,
      history,
      content,
      mount,
      referredFrom: referredFrom ?? null,
    };
  }

  function reattach(
    split: SplitState,
    next: SplitContent,
    referredFrom?: ReferredFrom
  ) {
    const otherSplits = state.splits.filter((s) => s.id !== split.id);
    const content = attachAliasContext(next);
    if (isDuplicateSplit(otherSplits, next)) return;

    const splitIndex = state.splits.findIndex((s) => s.id === split.id);
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
          const target = { ...s[i], content: content, referredFrom };
          return s.with(i, target);
        });
      }
      return setState('splits', (s) => {
        const i = s.findIndex((x) => x.id === split.id);
        if (i < 0) return s;
        const target = { ...s[i], content: content };
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
        ...(referredFrom !== undefined && { referredFrom }),
      };
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
  function replace(
    id: SplitId,
    options: {
      next: SplitContent;
      mergeHistory?: boolean;
      referredFrom?: ReferredFrom;
    }
  ) {
    const { next, mergeHistory, referredFrom } = options;
    const i = state.splits.findIndex((s) => s.id === id);
    if (i < 0) return console.error(`Split with id ${id} not found`);

    const content = attachAliasContext(next);

    const split = state.splits[i];
    if (mergeHistory) {
      split.history.merge(content);
    } else {
      split.history.push(content);
    }

    reattach(split, content, referredFrom);
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
      .flatMap((s) => [getAliasOrType(s.content), s.content.id])
      .map(String);
  };

  const getUrl = () => {
    return (
      state.splits.map((s) => getAliasOrType(s.content)).join('/') +
      '/' +
      state.splits.map((s) => s.content.id).join('/')
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
    if (state.splits.length <= 1 && !isSettingsPanelOpen()) {
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
      replace: ({ next, mergeHistory = false, referredFrom }) =>
        replace(currentSplit.id, { next, mergeHistory, referredFrom }),
      removeFromHistory: (predicate: (content: SplitContent) => boolean) => {
        removeFromHistory(currentSplit.id, predicate);
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
    };
  };

  function createNewSplit(options: CreateNewSplitOptions): SplitHandle {
    const { content, activate, referredFrom } = options;
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

    const split = buildSplit({ initialContent, isDefault, referredFrom });

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
      (s) => s.content.type === type && s.content.id === id
    );
    if (!match) return;
    return getSplit(match.id);
  }

  function reconcileSplits(newSplits: SplitContent[]) {
    const newState: SplitState[] = [];
    const currentCompositeSplits = state.splits.map(keyOfSplitState);
    const newCompositeSplits = newSplits.map(keyOfSplitContent);
    const changed =
      newCompositeSplits.join(',') !== currentCompositeSplits.join(',');

    if (!changed) return;

    const originalSplits = [...state.splits];

    const lookup = (type: BlockName | BlockAlias, id: string) =>
      originalSplits.find(
        (s) => s.content.type === type && s.content.id === id
      );

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
        newState.push(
          buildSplit({
            initialContent: split,
            isDefault: false,
            referredFrom: null,
          })
        );
      } else {
        newState.push(
          lookup(split.type, split.id) ??
            buildSplit({
              initialContent: split,
              isDefault: false,
              referredFrom: null,
            })
        );
      }
    }

    setState('splits', reconcile(newState));
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
  ): SplitHandle {
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
      });
    }
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
  };
}
