import type { Accessor } from 'solid-js';

/** Stable identity used by the headless list primitives. */
export type ListKey = string;

/** One resolved item and its current position in the collection. */
export type ListItemResult<TItem> = {
  item: TItem;
  index: number;
  key: ListKey;
};

/** Why focus moved. Consumers can use this to decide whether to scroll. */
export type ListFocusReason =
  | 'keyboard'
  | 'hover'
  | 'pointer'
  | 'restore'
  | 'programmatic';

/** Options shared by direct focus commands. */
export type ListFocusOptions = {
  reason?: ListFocusReason;
  /** Allow direct focus to bypass the list's navigability predicate. */
  force?: boolean;
};

/** Command-specific constraints layered on top of base list navigability. */
export type ListNavigationOptions<TItem> = ListFocusOptions & {
  /** Additional eligibility required by this navigation command. */
  isNavigable?: (item: TItem, index: number) => boolean;
  /** Override the controller's default wrapping policy for this command. */
  wrap?: boolean;
};

/**
 * Fallback used when a requested restoration key is not currently present.
 * `successor` moves to the item that took the key's place: its nearest
 * surviving neighbour from when it was last focused, later items first. With
 * no surviving neighbour the key is retained, as with `none`.
 */
export type ListFocusFallback =
  | 'none'
  | 'first'
  | 'last'
  | 'nearest'
  | 'successor';

/** Options for restoring focus from persisted view state. */
export type ListRestoreFocusOptions<TItem = unknown> = ListFocusOptions & {
  fallback?: ListFocusFallback;
  /** Fallbacks skip items this rejects (a load-more row, a heading). */
  isNavigable?: (item: TItem, index: number) => boolean;
  /** Center point for a nearest fallback. */
  nearestIndex?: number;
  /** Keep an unavailable key as the restoration anchor. Defaults to true. */
  retainUnavailable?: boolean;
};

/** Information emitted after an explicit focus command changes the anchor. */
export type ListFocusChange<TItem> = {
  current: ListItemResult<TItem> | undefined;
  previous: ListItemResult<TItem> | undefined;
  requestedKey: ListKey | undefined;
  reason: ListFocusReason;
};

/** Why an item was activated. */
export type ListActivationReason = 'keyboard' | 'pointer' | 'programmatic';

/** Item activation emitted by a list controller. */
export type ListActivation<
  TItem,
  TMetadata = unknown,
> = ListItemResult<TItem> & {
  reason: ListActivationReason;
  metadata?: TMetadata;
};

/** Options for activating an item. */
export type ListActivateOptions<TMetadata = unknown> = {
  reason?: ListActivationReason;
  /** Focus before activation. Defaults to true for keyed/index activation. */
  focus?: boolean | ListFocusOptions;
  metadata?: TMetadata;
};

/** Reactive item collection exposed by a list controller. */
export type ListItems<TItem> = {
  all: Accessor<readonly TItem[]>;
  count: Accessor<number>;
  keyOf: (item: TItem) => ListKey;
  get: (key: ListKey) => TItem | undefined;
  at: (index: number) => TItem | undefined;
  indexOf: (key: ListKey) => number;
  result: (key: ListKey) => ListItemResult<TItem> | undefined;
};
