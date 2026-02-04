import { IS_MAC } from '@core/constant/isMac';
import { logger } from '@observability/logger';
import { createEffect, createMemo } from 'solid-js';
import {
  macOptionReverse,
  shiftPunctuationMap,
  shiftPunctuationReverseMap,
} from './constants';
import { registerHotkey } from './hotkeys';
import {
  activeScope,
  activeScopeBranch,
  hotkeyScopeTree,
  hotkeysAwaitingKeyUp,
  hotkeyTokenMap,
  setActiveScope,
  setActiveScopeBranch,
  setExecutedTokens,
  setHotkeyTokenMap,
  setLastExecutedCommand,
  setPressedKeys,
} from './state';
import type { HotkeyToken } from './tokens';
import type {
  HotkeyCommand,
  HotkeyRegistrationOptions,
  ScopeNode,
  ValidHotkey,
} from './types';

/**
 * Removes hotkey commands from the global token map when their scope is destroyed.
 */
export function removeCommandsFromTokenMap(
  tokenMap: Map<HotkeyToken, HotkeyCommand[]>,
  commands: HotkeyCommand[]
): Map<HotkeyToken, HotkeyCommand[]> {
  if (commands.length === 0) return tokenMap;

  let newMap: Map<HotkeyToken, HotkeyCommand[]> | undefined;

  for (const command of commands) {
    if (!command.hotkeyToken) continue;

    const currentMap = newMap ?? tokenMap;
    const existingCommands = currentMap.get(command.hotkeyToken);
    if (!existingCommands) continue;

    const filtered = existingCommands.filter((c) => c !== command);
    if (filtered.length === existingCommands.length) continue;

    if (!newMap) {
      newMap = new Map(tokenMap);
    }

    if (filtered.length > 0) {
      newMap.set(command.hotkeyToken, filtered);
    } else {
      newMap.delete(command.hotkeyToken);
    }
  }

  return newMap ?? tokenMap;
}

type GetHotkeyCommandOptions = {
  /**
   * The property to sort by. Defaults to 'handlerPriority'.
   */
  sortBy?: 'displayPriority' | 'handlerPriority';
  /**
   * Sort direction. Defaults to 'desc' (higher values first).
   */
  sortDirection?: 'asc' | 'desc';
};

/**
 * Get hotkey commands from a scope, sorted by the specified property.
 *
 * @param scopeOrId - Either a ScopeNode or a scope ID string
 * @param hotkey - The hotkey to look up
 * @param options - Sorting options
 * @returns Array of commands sorted by the specified property, or empty array if not found
 *
 * @example
 * // Get commands sorted by handlerPriority (default)
 * const commands = getHotkeyCommands(scopeNode, 'h');
 *
 * // Get the highest priority command
 * const topCommand = getHotkeyCommands(scopeNode, 'h')[0];
 *
 * // Sort by displayPriority instead
 * const commands = getHotkeyCommands(scopeNode, 'h', { sortBy: 'displayPriority' });
 */
export function getHotkeyCommands(
  scopeOrId: ScopeNode | string,
  hotkey: ValidHotkey,
  options: GetHotkeyCommandOptions = {}
): HotkeyCommand[] {
  const { sortBy = 'handlerPriority', sortDirection = 'desc' } = options;

  const scopeNode =
    typeof scopeOrId === 'string' ? hotkeyScopeTree.get(scopeOrId) : scopeOrId;

  if (!scopeNode) return [];

  const commands = scopeNode.hotkeyCommands.get(hotkey);
  if (!commands || commands.length === 0) return [];

  // Sort by the specified property
  return [...commands].sort((a, b) => {
    const aVal = a[sortBy] ?? 0;
    const bVal = b[sortBy] ?? 0;
    return sortDirection === 'desc' ? bVal - aVal : aVal - bVal;
  });
}

/**
 * Get the first (highest priority by default) hotkey command from a scope.
 * Convenience wrapper around getHotkeyCommands.
 *
 * @param scopeOrId - Either a ScopeNode or a scope ID string
 * @param hotkey - The hotkey to look up
 * @param options - Sorting options
 * @returns The first command after sorting, or undefined if not found
 */
export function getHotkeyCommand(
  scopeOrId: ScopeNode | string,
  hotkey: ValidHotkey,
  options: GetHotkeyCommandOptions = {}
): HotkeyCommand | undefined {
  return getHotkeyCommands(scopeOrId, hotkey, options)[0];
}

let scopeCounter = 0;
export function getScopeId(prefix: string = 'scope'): string {
  const scopeId = `${prefix}_${scopeCounter++}`;
  return scopeId;
}

type RegisterScopeArgsBase = {
  parentScopeId?: string;
  scopeId: string;
  description?: string;
  detached?: boolean;
};

type RegisterDOMScopeArgs = RegisterScopeArgsBase & {
  type: 'dom';
  runWithInputFocused?: never;
  condition?: never;
};

type RegisterCommandScopeArgs = RegisterScopeArgsBase & {
  type: 'command';
  activationKeys?: ValidHotkey[];
};

type RegisterScopeArgs = RegisterDOMScopeArgs | RegisterCommandScopeArgs;

export function registerScope(args: RegisterScopeArgs) {
  const { parentScopeId, type, scopeId, description } = args;
  const parentScope = hotkeyScopeTree.get(parentScopeId ?? '');

  const baseScope = {
    scopeId: scopeId,
    description: description ?? undefined,
    parentScopeId: parentScopeId,
    childScopeIds: [],
    hotkeyCommands: new Map(),
    unkeyedCommands: [],
    detached: args.detached ?? false,
  };

  const newScope: ScopeNode =
    type === 'dom'
      ? {
          ...baseScope,
          type: 'dom',
        }
      : {
          ...baseScope,
          type: 'command',
          originalParentScopeId: parentScopeId ?? '',
          activationKeys: args.activationKeys ?? [],
        };

  hotkeyScopeTree.set(scopeId, newScope);
  if (parentScope) {
    parentScope.childScopeIds.push(scopeId);
  }
}

export function removeScope(scopeId: string) {
  const scopeTree = hotkeyScopeTree;
  const scope = scopeTree.get(scopeId);
  if (!scope) {
    if (import.meta.hot) {
      console.warn(
        `Scope ${scopeId} not found while attempting to remove scope`
      );
    }
    return;
  }

  // Collect all commands from this scope to remove from the global token map
  const commandsToRemove = [
    ...Array.from(scope.hotkeyCommands.values()).flat(),
    ...scope.unkeyedCommands,
  ];

  if (commandsToRemove.length > 0) {
    setHotkeyTokenMap((prev) =>
      removeCommandsFromTokenMap(prev, commandsToRemove)
    );
  }

  scope.hotkeyCommands.clear();
  scope.unkeyedCommands.length = 0;

  // if scope is in currently active scope branch, we want to "snip just above it", i.e. set active scope to closest DOM scope parent.
  if (scope.type === 'dom') {
    let currentScope = scopeTree.get(activeScope() ?? '');
    while (currentScope) {
      if (currentScope.scopeId === scopeId) {
        let parentScope = hotkeyScopeTree.get(currentScope.parentScopeId ?? '');
        let foundDOMScopeParent = false;
        while (parentScope) {
          const parentElement =
            parentScope.type === 'dom'
              ? getScopeElement(parentScope.scopeId)
              : null;
          if (parentElement instanceof HTMLElement) {
            parentElement.focus();
            setActiveScope(parentScope.scopeId);
            foundDOMScopeParent = true;
            break;
          }
          parentScope = hotkeyScopeTree.get(parentScope.parentScopeId ?? '');
        }
        if (!foundDOMScopeParent) {
          setActiveScope('global');
        }
        break;
      }
      currentScope = scopeTree.get(currentScope.parentScopeId ?? '');
    }
  }

  // Remove any awaiting keyup handlers for this scope
  hotkeysAwaitingKeyUp.filter((hotkey) => hotkey.scopeId !== scopeId);

  // Recursively remove all child scopes
  const childIds = [...scope.childScopeIds];
  for (const childId of childIds) {
    removeScope(childId);
  }

  // Remove reference from parent's children list
  const parentScope = scope.parentScopeId
    ? hotkeyScopeTree.get(scope.parentScopeId)
    : undefined;
  if (parentScope) {
    parentScope.childScopeIds = parentScope.childScopeIds.filter(
      (id) => id !== scopeId
    );
  }

  // Remove scope from scope tree
  hotkeyScopeTree.delete(scopeId);
}

/**
 * Used to 'exit' a command scope.
 */
export function activateClosestDOMScope() {
  let currentScope = hotkeyScopeTree.get(activeScope() ?? '');
  let activeScopeId = 'global';
  // find the closest active DOM scope
  while (currentScope) {
    const scopeElement =
      currentScope.type === 'dom'
        ? getScopeElement(currentScope.scopeId)
        : null;
    if (scopeElement instanceof HTMLElement) {
      scopeElement.focus();
      activeScopeId = currentScope.scopeId;
      break;
    }

    if (!currentScope.parentScopeId) break;
    currentScope = hotkeyScopeTree.get(currentScope.parentScopeId);
  }

  setActiveScope(activeScopeId);
}

export function updateActiveScopeBranch(activeScopeId: string | undefined) {
  const branch = new Set<string>();

  if (activeScopeId) {
    let currentScope = hotkeyScopeTree.get(activeScopeId);
    while (currentScope) {
      branch.add(currentScope.scopeId);
      if (!currentScope.parentScopeId) break;
      currentScope = hotkeyScopeTree.get(currentScope.parentScopeId);
    }
  }

  setActiveScopeBranch(branch);
}

export function isScopeInActiveBranch(scopeId: string): boolean {
  return activeScopeBranch().has(scopeId);
}

/**
 * Finds the first hotkey command for a given token that is in the current active scope branch
 */
export function getActiveCommandByToken(
  token: HotkeyToken
): HotkeyCommand | undefined;
export function getActiveCommandByToken(
  token: HotkeyToken,
  includeDependentCommandScopes: true
): HotkeyCommand[] | undefined;
export function getActiveCommandByToken(
  token: HotkeyToken,
  includeDependentCommandScopes?: boolean
): HotkeyCommand | HotkeyCommand[] | undefined {
  const commands = hotkeyTokenMap().get(token);
  if (!commands || commands.length === 0) return undefined;

  const branch = activeScopeBranch();

  if (includeDependentCommandScopes) {
    // When showDependentCommandScopes is true, look for commands in command scopes whose closest DOM scope parent is in the active branch. I.e. this is a command in a command scope (or potentiall a chain of command scopes) that could be initiated from the current active scope.
    for (const command of commands) {
      const commandScope = hotkeyScopeTree.get(command.scopeId);
      // Check if command is directly in the active branch
      if (branch.has(command.scopeId)) {
        return [command];
      }

      if (commandScope?.type === 'command') {
        const originalParentScope = hotkeyScopeTree.get(
          commandScope.originalParentScopeId
        );
        if (!originalParentScope) {
          logger.error('Original parent scope not found for command scope:', {
            error: new Error(
              'Original parent scope not found for command scope'
            ),
            commandScopeId: commandScope?.scopeId,
          });
          return [];
        }

        let reverseActivationCommands: HotkeyCommand[] = [];

        let closestDOMScopeParent: ScopeNode | undefined;

        let currentAncestor: ScopeNode | undefined = originalParentScope;
        let currentCommandScope: ScopeNode = commandScope;
        while (currentAncestor) {
          const activationKey = currentCommandScope.activationKeys?.at(0);
          if (activationKey) {
            const activationCommand = getHotkeyCommand(
              originalParentScope,
              activationKey
            );
            if (activationCommand) {
              reverseActivationCommands.push(activationCommand);
            } else break;
          }
          if (currentAncestor.type === 'dom') {
            closestDOMScopeParent = currentAncestor;
            break;
          }
          if (currentAncestor.originalParentScopeId) {
            const parentScope = hotkeyScopeTree.get(
              currentAncestor.originalParentScopeId
            );
            currentCommandScope = currentAncestor;
            currentAncestor = parentScope;
          } else {
            break;
          }
        }

        if (
          closestDOMScopeParent &&
          branch.has(closestDOMScopeParent.scopeId) &&
          reverseActivationCommands.every(
            (cmd) => cmd.hotkeys && cmd.hotkeys.length > 0
          )
        ) {
          const activationCommands = reverseActivationCommands.reverse();

          return activationCommands.concat(command);
        }
      }
    }

    return undefined;
  }

  // Return the first command that's in the active scope branch
  const command = commands.find((command) => branch.has(command.scopeId));
  return command;
}

/**
 * Returns a hotkey command for a given hotkey token. NOTE: this might not be THE command you are looking for, if there are hotkeys sharing the same token instantiated across different scopes. But this can be used in situations where you don't know or don't care about the scope you are in, e.g. when displaying hotkey metadata.
 */
export function getHotkeyCommandByToken(token: HotkeyToken) {
  const command = hotkeyTokenMap().get(token)?.at(0);
  return command;
}

// Helper function to get the primary hotkey string for a given token, pretty printed.
export function getPrettyHotkeyStringByToken(token: HotkeyToken) {
  const hotkey = hotkeyTokenMap().get(token)?.at(0)?.hotkeys?.[0];
  if (!hotkey) return undefined;
  return prettyPrintHotkeyString(hotkey);
}

/**
 * Runs the given hotkey command. This sets the executed tokens and last executed command.
 * @param command - The hotkey command to run.
 * @param e - The keyboard event.
 * @param pressedKeysString - The string of pressed keys.
 * @param scopeId - The id of the scope that the command is from.
 * @returns An object with the command captured, command scope activated, and propagation control flags.
 */
export function runCommand(
  command: HotkeyCommand,
  e?: KeyboardEvent,
  pressedKeysString?: string,
  scopeId?: string
) {
  const currentScopeId = activeScope();

  let commandCaptured: HotkeyCommand | undefined;
  let commandScopeActivated = false;
  let stopPropagation = false;

  if (!command.condition || command.condition()) {
    if (command.activateCommandScopeId) {
      const commandScope = hotkeyScopeTree.get(command.activateCommandScopeId);
      if (commandScope) {
        // When the command scope is activated, we set its parent scope to the active scope when it was called, so that when the command scope is deactivated, scope will return to the correct scope. The commmand scope will still get cleaned up correctly when it's original parent scope is removed.
        commandScope.parentScopeId = currentScopeId;
        setPressedKeys(new Set<string>());
        setActiveScope(commandScope.scopeId);
        if (!commandCaptured) {
          setExecutedTokens((prev) =>
            command.hotkeyToken
              ? prev.includes(command.hotkeyToken)
                ? prev
                : [...prev, command.hotkeyToken]
              : prev
          );
        }
        commandScopeActivated = true;
        e?.preventDefault();
        e?.stopPropagation();
      }
    }

    const captured = command.keyDownHandler?.(e);
    stopPropagation = captured ?? stopPropagation;

    if (captured) {
      setPressedKeys(new Set<string>());
      setLastExecutedCommand(command);
      commandCaptured = command;
      setExecutedTokens((prev) =>
        command.hotkeyToken
          ? prev.includes(command.hotkeyToken)
            ? prev
            : [...prev, command.hotkeyToken]
          : prev
      );
      e?.preventDefault();
      e?.stopPropagation();
    }

    if (
      command.keyUpHandler &&
      e?.type === 'keydown' &&
      scopeId &&
      !hotkeysAwaitingKeyUp.some(
        (h) => h.hotkey === pressedKeysString && h.scopeId === scopeId
      )
    ) {
      hotkeysAwaitingKeyUp.push({
        hotkey: pressedKeysString as ValidHotkey,
        scopeId: scopeId,
        command: () => command.keyUpHandler?.(e),
      });
    }
  }

  return {
    commandCaptured,
    commandScopeActivated,
    stopPropagation,
  };
}

export function normalizeEventKeyPress(e: KeyboardEvent): string {
  const key = e.key;
  if (key === ' ') return 'space';
  // Handle "dead" keys resulting from alt key press waiting for further input, e.g. opt+n
  // This is a hack, and will NOT work for non-US keyboards.
  if (key === 'Dead' && e.altKey) {
    const deadKey = e.code.slice(3).toLowerCase();
    return deadKey;
  }
  if (IS_MAC && e.altKey && key in macOptionReverse) {
    return macOptionReverse[key as keyof typeof macOptionReverse];
  }

  if (e.shiftKey && key in shiftPunctuationMap) {
    return shiftPunctuationMap[key as keyof typeof shiftPunctuationMap];
  }

  return key.toLowerCase();
}

// When you specify a hotkey for, e.g. '?', you want it show as '?' even though the actual key pressed was 'shift+/'. This function prints the printed punctuation key rather than the key combo.
export function prettyPrintHotkeyString(validHotkey: ValidHotkey) {
  if (validHotkey.includes('shift+')) {
    const shiftless = validHotkey.replace('shift+', '');
    if (shiftless in shiftPunctuationReverseMap) {
      return shiftPunctuationReverseMap[
        shiftless as keyof typeof shiftPunctuationReverseMap
      ];
    }
  }
  if (validHotkey.includes('escape')) {
    return validHotkey.replace('escape', 'esc');
  }
  return validHotkey;
}

export function getKeyString(pressedKeys: Set<string>): ValidHotkey {
  return Array.from(pressedKeys)
    .sort((a, b) => {
      const modifiers = ['ctrl', 'opt', 'shift', 'cmd'];
      const aIndex = modifiers.indexOf(a);
      const bIndex = modifiers.indexOf(b);

      // If both are modifiers, sort by modifier order
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }
      // If only a is a modifier, it comes first
      if (aIndex !== -1) return -1;
      // If only b is a modifier, it comes first
      if (bIndex !== -1) return 1;
      // If neither are modifiers, maintain original order
      return 0;
    })
    .join('+') as ValidHotkey;
}

export function getScopeElement(scopeId: string): Element | null {
  return document.querySelector(`[data-hotkey-scope="${scopeId}"]`);
}

// Returns the id of the closest parent scope, or 'global' if no parent scope is found.
export function findClosestParentScopeId(element: Element) {
  const parentElement = element.parentElement;
  if (!parentElement) return 'global';
  const closestParent = parentElement.closest('[data-hotkey-scope]');
  if (!closestParent) return 'global';
  return closestParent.getAttribute('data-hotkey-scope') ?? 'global';
}

export function findClosestParentScopeElement(element: Element) {
  return element.parentElement?.closest('[data-hotkey-scope]');
}

/**
 * Registers a hotkey in situations where the scopeId is a signal that may not have been set yet, or may change.
 * @param scopeSignal - An accessor that returns the scopeId where the hotkey is active.
 * @param args
 */
export function registerScopeSignalHotkey(
  scopeSignal: () => string,
  args: Omit<HotkeyRegistrationOptions, 'scopeId'>
) {
  let disposer: (() => void) | undefined;

  createEffect(() => {
    const scopeId = scopeSignal();

    if (disposer) {
      disposer();
      disposer = undefined;
    }

    if (!scopeId) return;

    const result = registerHotkey({
      hotkeyToken: args.hotkeyToken,
      hotkey: args.hotkey,
      condition: args.condition,
      scopeId,
      description: args.description,
      keyDownHandler: args.keyDownHandler,
      keyUpHandler: args.keyUpHandler,
      activateCommandScope: args.activateCommandScope,
      runWithInputFocused: args.runWithInputFocused,
      displayPriority: args.displayPriority,
      hide: args.hide,
      icon: args.icon,
      tags: args.tags,
    });

    disposer = result.dispose;

    // Return cleanup function for the effect
    return () => {
      if (disposer) {
        disposer();
        disposer = undefined;
      }
    };
  });
}

export const useIsInCommandScope = () => {
  return createMemo(() => {
    const currentScopeId = activeScope();
    if (!currentScopeId) return false;
    const scopeNode = hotkeyScopeTree.get(currentScopeId);
    return scopeNode?.type === 'command';
  });
};

/**
 * Look up a hotkey token and return true if a usable hotkey is mapped to that
 * token right now.
 * @param shortcut
 * @returns
 */
export const hasValidHotkey = (shortcut?: HotkeyToken) => {
  if (!shortcut) return false;
  const tokenShortcut = getPrettyHotkeyStringByToken(shortcut);
  if (!tokenShortcut) return false;
  const parts = tokenShortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.some((part) => part.length > 0);
};
