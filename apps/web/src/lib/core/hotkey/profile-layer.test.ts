import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { getShortcutSheet } from './getCommands';
import { registerHotkey, useHotKeyRoot } from './hotkeys';
import { hotkeyScopeTree, setActiveScope, setPressedKeys } from './state';
import type { HotkeyToken } from './tokens';
import type { HotkeyRegistrationOptions } from './types';
import {
  getPrettyHotkeyStringByToken,
  registerScope,
  removeScope,
  runTokenCommand,
} from './utils';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

const disposers: (() => void)[] = [];
const scopes: string[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  for (const scopeId of scopes.splice(0).reverse()) {
    if (hotkeyScopeTree.has(scopeId)) removeScope(scopeId);
  }
  setActiveScope('global');
  setPressedKeys(new Set<string>());
});

const PROFILE = { id: 'test-profile', label: () => 'Test profile' };

function domScope(scopeId: string, parentScopeId = 'global') {
  registerScope({ scopeId, parentScopeId, type: 'dom' });
  scopes.push(scopeId);
  return scopeId;
}

function leaderScope(scopeId: string) {
  registerScope({
    scopeId,
    parentScopeId: 'global',
    type: 'command',
    activationKeys: ['g'],
  });
  scopes.push(scopeId);
  return scopeId;
}

function mount(register: () => void) {
  createRoot((dispose) => {
    disposers.push(dispose);
    register();
  });
}

function command(
  options: Partial<HotkeyRegistrationOptions> &
    Pick<HotkeyRegistrationOptions, 'scopeId' | 'description'>
) {
  return registerHotkey({ keyDownHandler: () => true, ...options });
}

function press(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key }));
}

test('a turned-on profile key runs before later overrides and higher priorities, and steps aside when off', () => {
  const view = domScope('profile-dispatch-view');
  const [profileOn, setProfileOn] = createSignal(true);
  const ran: string[] = [];
  mount(() => {
    useHotKeyRoot();
    command({
      scopeId: view,
      hotkey: 's',
      description: 'Sort',
      keyDownHandler: () => {
        ran.push('sort');
        return true;
      },
    });
    command({
      scopeId: view,
      hotkey: 's',
      description: 'Status',
      profile: PROFILE,
      registrationType: 'add',
      condition: profileOn,
      keyDownHandler: () => {
        ran.push('status');
        return true;
      },
    });
    // Registered later as an override with a higher priority: without the
    // profile layer it would eclipse the profile's key.
    command({
      scopeId: view,
      hotkey: 's',
      description: 'Sort again',
      handlerPriority: 4,
      keyDownHandler: () => {
        ran.push('sort again');
        return true;
      },
    });
  });
  setActiveScope(view);

  press('s');
  setProfileOn(false);
  press('s');

  expect(ran).toEqual(['status', 'sort again']);
});

test('the sheet labels profile keys and lists the Macro shortcuts they took over', () => {
  const view = domScope('profile-sheet-view');
  const goTo = leaderScope('profile-sheet-go-to');
  const createMenu = leaderScope('profile-sheet-create');
  mount(() => {
    command({ scopeId: view, hotkey: 's', description: 'Sort' });
    command({
      scopeId: view,
      hotkey: 's',
      description: 'Change status',
      profile: PROFILE,
      registrationType: 'add',
    });
    command({
      scopeId: 'global',
      hotkey: 'c',
      description: 'Create menu',
      activateCommandScopeId: createMenu,
      hide: true,
      registrationType: 'add',
    });
    command({ scopeId: createMenu, hotkey: 't', description: 'New task' });
    command({
      scopeId: view,
      hotkey: 'c',
      description: 'Create task',
      profile: PROFILE,
      registrationType: 'add',
    });
    command({
      scopeId: 'global',
      hotkey: 'g',
      description: 'Go to',
      activateCommandScopeId: goTo,
      hide: true,
      registrationType: 'add',
    });
    command({
      scopeId: goTo,
      hotkey: 'e',
      description: 'Go to Email',
      registrationType: 'add',
    });
    command({
      scopeId: goTo,
      hotkey: 'e',
      description: 'All tasks',
      profile: PROFILE,
      registrationType: 'add',
      sheetSection: 'view',
    });
  });

  const sheet = getShortcutSheet(view);

  expect(sheet.view).toEqual([
    {
      description: 'Change status',
      bindings: [['s']],
      profileLabel: 'Test profile',
    },
    {
      description: 'Create task',
      bindings: [['c']],
      profileLabel: 'Test profile',
    },
    {
      description: 'All tasks',
      bindings: [['g', 'e']],
      profileLabel: 'Test profile',
    },
  ]);
  // The create leader's key is taken, so its sequences no longer work here.
  expect(sheet.app.map((entry) => entry.description)).not.toContain('New task');
  expect(sheet.replaced).toEqual([
    { description: 'Sort', bindings: [['s']], profileLabel: 'Test profile' },
    {
      description: 'Create menu',
      bindings: [['c']],
      profileLabel: 'Test profile',
    },
    {
      description: 'Go to Email',
      bindings: [['g', 'e']],
      profileLabel: 'Test profile',
    },
  ]);
});

test('running by token picks the nearest command that can run, falling through a token list', () => {
  const list = domScope('profile-token-list');
  const thread = domScope('profile-token-thread', list);
  const markUnread = 'profile-test:mark-unread' as HotkeyToken;
  const markRead = 'profile-test:mark-read' as HotkeyToken;
  const [unread, setUnread] = createSignal(false);
  const ran: string[] = [];
  mount(() => {
    command({
      scopeId: list,
      hotkey: 'u',
      hotkeyToken: markUnread,
      description: 'List mark unread',
      keyDownHandler: () => {
        ran.push('list unread');
        return true;
      },
    });
    command({
      scopeId: thread,
      hotkey: 'u',
      hotkeyToken: markUnread,
      description: 'Mark unread',
      condition: () => !unread(),
      keyDownHandler: () => {
        ran.push('thread unread');
        setUnread(true);
        return true;
      },
    });
    command({
      scopeId: thread,
      hotkey: 'shift+u',
      hotkeyToken: markRead,
      description: 'Mark read',
      condition: unread,
      keyDownHandler: () => {
        ran.push('thread read');
        setUnread(false);
        return true;
      },
    });
  });
  setActiveScope(thread);

  expect(runTokenCommand([markUnread, markRead])).toBe(true);
  expect(runTokenCommand([markUnread, markRead])).toBe(true);
  setActiveScope('global');
  expect(runTokenCommand([markUnread, markRead])).toBe(false);

  expect(ran).toEqual(['thread unread', 'thread read']);
});

test("token displays show a turned-on profile's key and drop keys it took", () => {
  const view = domScope('profile-display-view');
  const status = 'profile-test:status' as HotkeyToken;
  const sort = 'profile-test:sort' as HotkeyToken;
  const [profileOn, setProfileOn] = createSignal(true);
  mount(() => {
    command({
      scopeId: view,
      hotkey: 'shift+cmd+s',
      hotkeyToken: status,
      description: 'Status',
    });
    command({
      scopeId: view,
      hotkey: 's',
      hotkeyToken: sort,
      description: 'Sort',
    });
    command({
      scopeId: view,
      hotkey: 's',
      description: 'Status',
      profile: PROFILE,
      aliasOf: [status],
      registrationType: 'add',
      condition: profileOn,
    });
  });
  setActiveScope(view);

  expect(getPrettyHotkeyStringByToken(status)).toBe('s');
  expect(getPrettyHotkeyStringByToken(sort)).toBeUndefined();

  setProfileOn(false);
  expect(getPrettyHotkeyStringByToken(status)).toBe('shift+cmd+s');
  expect(getPrettyHotkeyStringByToken(sort)).toBe('s');
});
