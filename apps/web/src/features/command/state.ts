import type { CommandWithInfo } from '@core/hotkey/getCommands';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import type { EntityData } from '@entity';
import { type Accessor, createSignal, type Setter } from 'solid-js';
import type { CategoryFilter } from './types';

/** timestamp threshold for resetting state after menu close */
const STATE_RESET_THRESHOLD_MS = 2_000;

/**
 * A suggestion shown above the results for the place the menu was opened
 * from, e.g. a design's own actions menu. Cleared when the menu closes.
 */
export interface CommandMenuHint {
  message: string;
  /** The key that runs it, as shown (`⌘P`). */
  shortcut: string;
  /** Whether a key press in the menu is that key. */
  matches: (e: KeyboardEvent) => boolean;
  run: () => void;
}

interface ICommandState {
  /** visibility */
  isOpen: Accessor<boolean>;
  setIsOpen: Setter<boolean>;
  toggle: () => void;
  open: () => void;
  close: () => void;

  /** query */
  query: Accessor<string>;
  setQuery: Setter<string>;
  clearQuery: () => void;

  /** selected index */
  selectedIndex: Accessor<number>;
  setSelectedIndex: Setter<number>;
  resetSelectedIndex: () => void;

  /** category filter */
  categoryFilter: Accessor<CategoryFilter>;
  setCategoryFilter: Setter<CategoryFilter>;
  resetCategoryFilter: () => void;

  /** command scope (for multi-stage commands) */
  commandScopeCommands: Accessor<CommandWithInfo[]>;
  setCommandScopeCommands: Setter<CommandWithInfo[]>;
  clearCommandScopeCommands: () => void;
  isInCommandScope: Accessor<boolean>;

  /** input placeholder while a command scope is active */
  commandScopePlaceholder: Accessor<string | undefined>;
  registerCommandScopePlaceholder: (
    scopeId: string,
    placeholder: string
  ) => () => void;
  activateCommandScopePlaceholder: (scopeId: string) => void;

  /** entity action mode (for selection modification commands) */
  entityActionEntities: Accessor<EntityData[]>;
  setEntityActionEntities: Setter<EntityData[]>;
  clearEntityActionEntities: () => void;
  isEntityActionMode: Accessor<boolean>;
  openForEntityAction: (entities: EntityData[]) => void;

  /** a suggestion for where the menu was opened */
  hint: Accessor<CommandMenuHint | undefined>;
  setHint: Setter<CommandMenuHint | undefined>;

  /** lifecycle */
  maybeResetState: () => void;
  forceReset: () => void;
  onMenuClose: () => void;
  onMenuOpen: () => void;
}

function createCommandState(): ICommandState {
  const [isOpen, setIsOpen] = createControlledOpenSignal(false, {
    id: 'command',
  });
  const [query, setQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [categoryFilter, setCategoryFilter] =
    createSignal<CategoryFilter>('all');
  const [lastClosedTime, setLastClosedTime] = createSignal(0);
  const [commandScopeCommands, setCommandScopeCommands] = createSignal<
    CommandWithInfo[]
  >([]);
  const [entityActionEntities, setEntityActionEntities] = createSignal<
    EntityData[]
  >([]);

  /** Optional input placeholders for command scopes, keyed by scope id. */
  const commandScopePlaceholders = new Map<string, string>();
  const [commandScopePlaceholder, setCommandScopePlaceholder] =
    createSignal<string>();

  const [hint, setHint] = createSignal<CommandMenuHint>();

  function registerCommandScopePlaceholder(
    scopeId: string,
    placeholder: string
  ) {
    commandScopePlaceholders.set(scopeId, placeholder);
    return () => {
      commandScopePlaceholders.delete(scopeId);
    };
  }

  function activateCommandScopePlaceholder(scopeId: string) {
    setCommandScopePlaceholder(commandScopePlaceholders.get(scopeId));
  }

  function toggle() {
    setIsOpen((prev) => !prev);
  }

  function open() {
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
  }

  function clearQuery() {
    setQuery('');
  }

  function resetSelectedIndex() {
    setSelectedIndex(0);
  }

  function resetCategoryFilter() {
    setCategoryFilter('all');
  }

  function clearCommandScopeCommands() {
    setCommandScopeCommands([]);
    setCommandScopePlaceholder(undefined);
  }

  function isInCommandScope() {
    return commandScopeCommands().length > 0;
  }

  function clearEntityActionEntities() {
    setEntityActionEntities([]);
  }

  function isEntityActionMode() {
    return entityActionEntities().length > 0;
  }

  function openForEntityAction(entities: EntityData[]) {
    setEntityActionEntities(entities);
    setIsOpen(true);
  }

  function maybeResetState() {
    const now = Date.now();
    if (now - lastClosedTime() >= STATE_RESET_THRESHOLD_MS) {
      forceReset();
    }
  }

  function forceReset() {
    clearQuery();
    resetSelectedIndex();
    resetCategoryFilter();
    clearCommandScopeCommands();
    clearEntityActionEntities();
  }

  function onMenuClose() {
    setLastClosedTime(Date.now());
    setHint(undefined);
    // Opening clears the query too late for a menu that mounts reading it, and
    // the previous search's results would briefly reappear.
    clearQuery();
    clearCommandScopeCommands();
    clearEntityActionEntities();
  }

  function onMenuOpen() {
    clearQuery();
    resetSelectedIndex();
  }

  return {
    isOpen,
    setIsOpen,
    toggle,
    open,
    close,

    query,
    setQuery,
    clearQuery,

    selectedIndex,
    setSelectedIndex,
    resetSelectedIndex,

    categoryFilter,
    setCategoryFilter,
    resetCategoryFilter,

    commandScopeCommands,
    setCommandScopeCommands,
    clearCommandScopeCommands,
    isInCommandScope,

    commandScopePlaceholder,
    registerCommandScopePlaceholder,
    activateCommandScopePlaceholder,

    entityActionEntities,
    setEntityActionEntities,
    clearEntityActionEntities,
    isEntityActionMode,
    openForEntityAction,

    hint,
    setHint,

    maybeResetState,
    forceReset,
    onMenuClose,
    onMenuOpen,
  };
}

/** Global command menu state singleton */
export const CommandState = createCommandState();
