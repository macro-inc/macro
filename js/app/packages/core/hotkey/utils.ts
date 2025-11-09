import { IS_MAC } from '@core/constant/isMac';
import {
  macOptionReverse,
  shiftPunctuationMap,
  shiftPunctuationReverseMap,
} from './constants';
import {
  activeScopeStack,
  hotkeyScopeTree,
  hotkeysAwaitingKeyUp,
  setActiveScopeStack,
} from './state';
import type { ScopeNode, ValidHotkey } from './types';

// Pushes a scope to the active scope stack, if it is not already the active scope.
export function pushActiveScope(scopeId: string) {
  setActiveScopeStack((prev) => {
    if (prev.at(-1) === scopeId) return prev;
    return [...prev, scopeId];
  });
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
  element?: Element;
  runWithInputFocused?: never;
  condition?: never;
};

type RegisterCommandScopeArgs = RegisterScopeArgsBase & {
  type: 'command';
};

type RegisterScopeArgs = RegisterDOMScopeArgs | RegisterCommandScopeArgs;

export function registerScope(args: RegisterScopeArgs) {
  const { parentScopeId, type, scopeId, description } = args;

  const baseScope = {
    id: scopeId,
    description: description ?? undefined,
    parentScopeId: parentScopeId,
    childScopeIds: [],
    transitions: new Map(),
    hotkeyCommands: new Map(),
    unkeyedCommands: [],
    detached: args.detached ?? false,
  };

  const newScope: ScopeNode =
    type === 'dom'
      ? {
          ...baseScope,
          type: 'dom',
          element: args.element ?? document.body,
        }
      : {
          ...baseScope,
          type: 'command',
        };

  hotkeyScopeTree.set(scopeId, newScope);
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

  // if scope is in currently active scope branch, we want to "snip just above it", i.e. set active scope to closest DOM scope parent.
  if (scope.type === 'dom') {
    let currentScope = scopeTree.get(activeScopeStack().at(-1) ?? '');
    while (currentScope) {
      if (currentScope.id === scopeId) {
        let parentScope = hotkeyScopeTree.get(currentScope.parentScopeId ?? '');
        let foundDOMScopeParent = false;
        while (parentScope) {
          if (
            parentScope.type === 'dom' &&
            parentScope.element instanceof HTMLElement
          ) {
            parentScope.element.focus();
            pushActiveScope(parentScope.id);
            foundDOMScopeParent = true;
            break;
          }
          parentScope = hotkeyScopeTree.get(parentScope.parentScopeId ?? '');
        }
        if (!foundDOMScopeParent) {
          pushActiveScope('global');
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
  let currentScope = hotkeyScopeTree.get(activeScopeStack().at(-1) ?? '');
  let activeScopeId = 'global';
  // find the closest active DOM scope
  while (currentScope) {
    if (
      currentScope.type === 'dom' &&
      currentScope.element instanceof HTMLElement
    ) {
      currentScope.element.focus();
      activeScopeId = currentScope.id;
      break;
    }

    if (!currentScope.parentScopeId) break;
    currentScope = hotkeyScopeTree.get(currentScope.parentScopeId);
  }

  pushActiveScope(activeScopeId);
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
export function prettyPrintHotkeyString(validHotkey?: ValidHotkey) {
  if (!validHotkey) return undefined;
  if (validHotkey.includes('shift+')) {
    const shiftless = validHotkey.replace('shift+', '');
    if (shiftless in shiftPunctuationReverseMap) {
      return shiftPunctuationReverseMap[
        shiftless as keyof typeof shiftPunctuationReverseMap
      ];
    }
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
