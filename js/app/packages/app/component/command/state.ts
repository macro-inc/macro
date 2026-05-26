import type { CommandWithInfo } from '@core/hotkey/getCommands';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import type { EntityData } from '@entity';
import { type Accessor, createSignal, type Setter } from 'solid-js';
import type { CategoryFilter } from './types';

/** timestamp threshold for resetting state after menu close */
const STATE_RESET_THRESHOLD_MS = 2_000;

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

  /** entity action mode (for selection modification commands) */
  entityActionEntities: Accessor<EntityData[]>;
  setEntityActionEntities: Setter<EntityData[]>;
  clearEntityActionEntities: () => void;
  isEntityActionMode: Accessor<boolean>;
  openForEntityAction: (entities: EntityData[]) => void;

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

    entityActionEntities,
    setEntityActionEntities,
    clearEntityActionEntities,
    isEntityActionMode,
    openForEntityAction,

    maybeResetState,
    forceReset,
    onMenuClose,
    onMenuOpen,
  };
}

/** Global command menu state singleton */
export const CommandState = createCommandState();
