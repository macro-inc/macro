import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';
import type { HotkeyToken } from './tokens';
import type { HotkeyCommand, ScopeNode, ValidHotkey } from './types';
import { updateActiveScopeBranch } from './utils';

const initialTree = new Map<string, ScopeNode>([
  [
    'global',
    {
      scopeId: 'global',
      type: 'dom',
      childScopeIds: [],
      commands: [],
      detached: true,
    },
  ],
]);

export const hotkeyScopeTree = initialTree;

export const [activeScope, setActiveScopeInner] =
  createSignal<string>('global');

// The non-global DOM scopes that were most recently active, newest last.
// Lets neutral regions restore a real scope after the active scope decayed
// to 'global' while focus was away in an overlay (see attachGlobalDOMScope).
// A history rather than a single value because the decay often happens by
// removing the scope that was active (e.g. closing the launcher, which owns
// its own scope) — the scope to restore is then the previous live one.
const activeDOMScopeHistory: string[] = [];
const ACTIVE_DOM_SCOPE_HISTORY_LIMIT = 20;

export function setActiveScope(
  ...params: Parameters<typeof setActiveScopeInner>
) {
  const scopeId = setActiveScopeInner(...params);
  if (scopeId !== 'global' && hotkeyScopeTree.get(scopeId)?.type === 'dom') {
    const existing = activeDOMScopeHistory.indexOf(scopeId);
    if (existing !== -1) activeDOMScopeHistory.splice(existing, 1);
    activeDOMScopeHistory.push(scopeId);
    if (activeDOMScopeHistory.length > ACTIVE_DOM_SCOPE_HISTORY_LIMIT) {
      activeDOMScopeHistory.shift();
    }
  }
  updateActiveScopeBranch(scopeId);
}

/**
 * The most recently active DOM scope that still exists. Dead entries are
 * pruned as they are found.
 */
export function findLastLiveActiveDOMScope(): string | undefined {
  for (let i = activeDOMScopeHistory.length - 1; i >= 0; i--) {
    const scopeId = activeDOMScopeHistory[i];
    if (scopeId && hotkeyScopeTree.get(scopeId)?.type === 'dom') {
      return scopeId;
    }
    activeDOMScopeHistory.splice(i, 1);
  }
  return undefined;
}

export const [pressedKeys, setPressedKeys] = createSignal<Set<string>>(
  new Set()
);

export const clearPressedKeys = () => {
  setPressedKeys(new Set<string>());
};

export const [executedTokens, setExecutedTokens] = makePersisted(
  createSignal<string[]>([]),
  {
    name: 'executedTokens',
  }
);

export const [lastExecutedCommand, setLastExecutedCommand] =
  createSignal<HotkeyCommand>();

// Tracks hotkeys that need their keyUp handlers called
export const hotkeysAwaitingKeyUp: {
  hotkey: ValidHotkey;
  scopeId: string;
  command: () => void;
}[] = [];

export const [activeScopeBranch, setActiveScopeBranch] = createSignal<
  Set<string>
>(new Set());

export const [hotkeyTokenMap, setHotkeyTokenMap] = createSignal<
  Map<HotkeyToken, HotkeyCommand[]>
>(new Map());
