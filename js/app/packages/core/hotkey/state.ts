import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';
import type { HotkeyToken } from './tokens';
import type { HotkeyCommand, ScopeNode, ValidHotkey } from './types';

const initialTree = new Map<string, ScopeNode>([
  [
    'global',
    {
      id: 'global',
      type: 'dom',
      element: document.body,
      childScopeIds: [],
      hotkeyCommands: new Map(),
      unkeyedCommands: [],
      detached: true,
    },
  ],
]);

export const hotkeyScopeTree = initialTree;

export const [activeScopeStack, setActiveScopeStack] = createSignal<string[]>([
  'global',
]);

export const [pressedKeys, setPressedKeys] = createSignal<Set<string>>(
  new Set()
);

export const [executedTokens, setExecutedTokens] = makePersisted(
  createSignal<string[]>([]),
  {
    name: 'executedTokens',
  }
);

// Tracks hotkeys that need their keyUp handlers called
export const hotkeysAwaitingKeyUp: {
  hotkey: ValidHotkey;
  scopeId: string;
  command: () => void;
}[] = [];

export const [hotkeyTokenMap, setHotkeyTokenMap] = createSignal<
  Map<HotkeyToken, HotkeyCommand>
>(new Map());
