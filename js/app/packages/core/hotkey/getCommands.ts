import { isEditableInput } from '@core/util/isEditableInput';
import { activeElement } from 'app/signal/focus';
import { createMemo } from 'solid-js';
import { activeScopeStack, hotkeyScopeTree } from './state';
import type { HotkeyCommand, ValidHotkey } from './types';

type sortAndFilterOptions = {
  // orders commands from the active scope to the global scope, sub-ordered by displayPriority
  sortByScopeLevel?: boolean;
  // hides commands that are shadowed by another command in a more specific scope
  hideShadowedCommands?: boolean;
  // shows commands that don't have hotkeys
  hideCommandsWithoutHotkeys?: boolean;
  // shows only commands from the specified scope, not from all scopes
  limitToCurrentScope?: boolean;
};

// This is reactive on active scope (if scope not specified), activeElement, and commmand conditions.
export function useActiveCommands(
  displayOptions?: sortAndFilterOptions,
  scope?: string
) {
  return createMemo(() => {
    const scopeId = scope ?? activeScopeStack().at(-1) ?? '';
    return getActiveCommandsFromScope(scopeId, displayOptions ?? {});
  });
}

export type CommandWithInfo = HotkeyCommand & {
  // the current active scope is 0, the parent scope is 1, etc.
  scopeLevel: number;
  // true if the command's hotkey is shadowed by another command in a lower scope level
  hotkeyIsShadowed: boolean;
};

// You can use this non-reatively to "print" the commands for a given scope with current conditions
export function getActiveCommandsFromScope(
  scopeId: string,
  displayOptions: sortAndFilterOptions = {}
) {
  let currentScopeNode = hotkeyScopeTree.get(scopeId);
  const hotkeySet: Set<ValidHotkey> = new Set();
  const commands: CommandWithInfo[] = [];
  let scopeLevel = 0;
  while (currentScopeNode) {
    const scopeCommands = Array.from([
      ...(currentScopeNode?.hotkeyCommands.values() ?? []),
      ...(currentScopeNode?.unkeyedCommands ?? []),
    ])
      .filter(filterCommands(displayOptions))
      .map((command) => {
        const hotkeys = command.hotkeys ?? [];
        const isShadowed = hotkeys.some((hk) => hotkeySet.has(hk));
        hotkeys.forEach((hk) => hotkeySet.add(hk));
        return { ...command, scopeLevel, hotkeyIsShadowed: isShadowed };
      });
    commands.push(...scopeCommands);
    if (displayOptions.limitToCurrentScope) {
      break;
    }
    currentScopeNode = hotkeyScopeTree.get(
      currentScopeNode?.parentScopeId ?? ''
    );
    scopeLevel++;
  }
  if (displayOptions.hideShadowedCommands) {
    commands.filter((command) => !command.hotkeyIsShadowed);
  }
  commands.sort((a, b) => {
    if (displayOptions.sortByScopeLevel) {
      if (a.scopeLevel !== b.scopeLevel) {
        return a.scopeLevel - b.scopeLevel;
      }
      return (b.displayPriority ?? 0) - (a.displayPriority ?? 0);
    }
    return (b.displayPriority ?? 0) - (a.displayPriority ?? 0);
  });
  return commands;
}

const filterCommands = (displayOptions: sortAndFilterOptions) => {
  return (command: HotkeyCommand) => {
    return (
      (command.hotkeys || !displayOptions.hideCommandsWithoutHotkeys) &&
      (!command.condition || command.condition()) &&
      (!isEditableInput(activeElement() as HTMLElement) ||
        command.runWithInputFocused) &&
      command.hide !== true
    );
  };
};
