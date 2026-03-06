import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { createSignal, type Accessor, type Setter } from 'solid-js';
import type { CommandWithInfo } from '@core/hotkey/getCommands';
import type { EntityData } from '@entity';
import { CategoryFilter } from '../command/types';

/** timestamp threshold for resetting state after menu close */
const STATE_RESET_THRESHOLD_MS = 2_000;

export interface ICommandState {
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

  /** category filter */
  categoryFilter: Accessor<CategoryFilter>;
  setCategoryFilter: Setter<CategoryFilter>;
  resetCategoryFilter: () => void;

  /** command scope (for multi-stage commands) */
  commandScopeCommands: Accessor<CommandWithInfo[]>;
  setCommandScopeCommands: Setter<CommandWithInfo[]>;
  clearCommandScopeCommands: () => void;
  isInCommandScope: Accessor<boolean>;

  /** lifecycle */
  maybeResetState: () => void;
  forceReset: () => void;
  onMenuClose: () => void;
  onMenuOpen: () => void;
}

function createSearchState(): ICommandState {
  const [isOpen, setIsOpen] = createControlledOpenSignal(false, {
    id: 'command',
  });
  const [query, setQuery] = createSignal('');
  const [categoryFilter, setCategoryFilter] =
    createSignal<CategoryFilter>('all');
  const [lastClosedTime, setLastClosedTime] = createSignal(0);
  const [commandScopeCommands, setCommandScopeCommands] = createSignal<
    CommandWithInfo[]
  >([]);

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

  function resetCategoryFilter() {
    setCategoryFilter('all');
  }

  function clearCommandScopeCommands() {
    setCommandScopeCommands([]);
  }

  function isInCommandScope() {
    return commandScopeCommands().length > 0;
  }

  function maybeResetState() {
    const now = Date.now();
    if (now - lastClosedTime() >= STATE_RESET_THRESHOLD_MS) {
      forceReset();
    }
  }

  function forceReset() {
    clearQuery();
    resetCategoryFilter();
    clearCommandScopeCommands();
  }

  function onMenuClose() {
    setLastClosedTime(Date.now());
    clearCommandScopeCommands();
  }

  function onMenuOpen() {
    clearQuery();
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

    categoryFilter,
    setCategoryFilter,
    resetCategoryFilter,

    commandScopeCommands,
    setCommandScopeCommands,
    clearCommandScopeCommands,
    isInCommandScope,

    maybeResetState,
    forceReset,
    onMenuClose,
    onMenuOpen,
  };
}

/** Global command menu state singleton */
export const SearchState = createSearchState();
