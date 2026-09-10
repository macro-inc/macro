import { type Accessor, createMemo, createSignal } from 'solid-js';
import type { ListKey } from './types';

export type CreateDisclosureStateOptions = {
  /** Whether unknown keys are expanded. Defaults to false. */
  defaultExpanded?: boolean;
  /** Keys initially differing from `defaultExpanded`. */
  initialToggledKeys?: Iterable<ListKey>;
  onChange?: (toggledKeys: ReadonlySet<ListKey>) => void;
};

/** Generic expanded/collapsed state keyed independently from rendered items. */
export type DisclosureState = {
  defaultExpanded: boolean;
  toggledKeys: Accessor<ReadonlySet<ListKey>>;
  isExpanded: (key: ListKey) => boolean;
  setExpanded: (key: ListKey, expanded: boolean) => void;
  expand: (key: ListKey) => void;
  collapse: (key: ListKey) => void;
  toggle: (key: ListKey) => void;
  replaceToggled: (keys: Iterable<ListKey>) => void;
  /** Return every key to its default state. */
  reset: () => void;
};

/**
 * Tracks only keys whose disclosure state differs from the default.
 *
 * This works for paginated collections because the complete key universe is
 * not required to represent "all expanded" or "all collapsed".
 */
export function createDisclosureState(
  options: CreateDisclosureStateOptions = {}
): DisclosureState {
  const defaultExpanded = options.defaultExpanded ?? false;
  const toggled = new Set(options.initialToggledKeys ?? []);
  const [version, invalidate] = createSignal(undefined, { equals: false });

  const toggledKeys = createMemo<ReadonlySet<ListKey>>(() => {
    version();
    return new Set(toggled);
  });

  const expandedWithoutTracking = (key: ListKey) =>
    toggled.has(key) ? !defaultExpanded : defaultExpanded;

  const notify = () => {
    invalidate();
    options.onChange?.(new Set(toggled));
  };

  const setExpanded = (key: ListKey, expanded: boolean) => {
    const shouldToggle = expanded !== defaultExpanded;
    if (shouldToggle === toggled.has(key)) return;

    if (shouldToggle) toggled.add(key);
    else toggled.delete(key);
    notify();
  };

  const replaceToggled = (keys: Iterable<ListKey>) => {
    const next = new Set(keys);
    if (
      next.size === toggled.size &&
      [...next].every((key) => toggled.has(key))
    ) {
      return;
    }

    toggled.clear();
    for (const key of next) toggled.add(key);
    notify();
  };

  return {
    defaultExpanded,
    toggledKeys,
    isExpanded: (key) => {
      version();
      return expandedWithoutTracking(key);
    },
    setExpanded,
    expand: (key) => setExpanded(key, true),
    collapse: (key) => setExpanded(key, false),
    toggle: (key) => setExpanded(key, !expandedWithoutTracking(key)),
    replaceToggled,
    reset: () => replaceToggled([]),
  };
}
