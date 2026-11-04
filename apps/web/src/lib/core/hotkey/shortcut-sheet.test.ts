import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, test } from 'vitest';
import { getRunnableHotkeys, getShortcutSheet } from './getCommands';
import { registerHotkey } from './hotkeys';
import { hotkeyScopeTree } from './state';
import { registerScope, removeScope } from './utils';

const disposers: (() => void)[] = [];
const scopes: string[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  for (const scope of scopes.splice(0)) {
    if (hotkeyScopeTree.has(scope)) removeScope(scope);
  }
});

function domScope(scopeId: string) {
  registerScope({ scopeId, parentScopeId: 'global', type: 'dom' });
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

test('lists hidden navigation keys, leader sequences and the nearest binding of a key', () => {
  const view = domScope('sheet-view');
  const goTo = leaderScope('sheet-go-to');
  const [archived, setArchived] = createSignal(false);
  createRoot((dispose) => {
    disposers.push(dispose);
    const handler = () => true;
    registerHotkey({
      scopeId: view,
      hotkey: ['j', 'arrowdown'],
      description: 'Move down',
      keyDownHandler: handler,
      hide: true,
    });
    registerHotkey({
      scopeId: view,
      hotkey: 'e',
      description: 'Mark done',
      keyDownHandler: handler,
      condition: () => !archived(),
    });
    // Shadowed by the view's `e`, so it must not be documented for this view.
    registerHotkey({
      scopeId: 'global',
      hotkey: 'e',
      description: 'Global e',
      keyDownHandler: handler,
    });
    registerHotkey({
      scopeId: 'global',
      hotkey: 'g',
      description: 'Go to',
      keyDownHandler: handler,
      activateCommandScopeId: goTo,
      hide: true,
      registrationType: 'add',
    });
    registerHotkey({
      scopeId: goTo,
      hotkey: 'i',
      description: 'Go to Home',
      keyDownHandler: handler,
      registrationType: 'add',
    });
    // A view claiming the same letter runs first, so it is what g i does.
    registerHotkey({
      scopeId: goTo,
      hotkey: 'i',
      description: 'Go to Signal',
      keyDownHandler: handler,
      registrationType: 'add',
      handlerPriority: 3,
      sheetSection: 'view',
    });
  });

  const sheet = getShortcutSheet(view);
  // The view's letter is listed with the view's keys, not under Everywhere.
  expect(sheet.view).toEqual([
    { description: 'Move down', bindings: [['j'], ['arrowdown']] },
    { description: 'Mark done', bindings: [['e']] },
    { description: 'Go to Signal', bindings: [['g', 'i']] },
  ]);
  expect(sheet.app.map((entry) => entry.description)).not.toContain(
    'Go to Signal'
  );
  expect(sheet.app.map((entry) => entry.description)).not.toContain('Global e');
  expect(sheet.app.map((entry) => entry.description)).not.toContain('Go to');
  expect(sheet.app.map((entry) => entry.description)).not.toContain(
    'Go to Home'
  );

  // Conditions describe what works right now.
  setArchived(true);
  expect(
    getShortcutSheet(view).view.map((entry) => entry.description)
  ).not.toContain('Mark done');
});

test('keeps the keys of a partly shadowed command and follows handler priority', () => {
  const view = domScope('sheet-partial-view');
  createRoot((dispose) => {
    disposers.push(dispose);
    const handler = () => true;
    // The view claims `e`; the global command still answers to `x`.
    registerHotkey({
      scopeId: view,
      hotkey: 'e',
      description: 'Mark done',
      keyDownHandler: handler,
    });
    registerHotkey({
      scopeId: 'global',
      hotkey: ['e', 'x'],
      description: 'Select',
      keyDownHandler: handler,
    });
    // Two handlers on one key in one scope: the higher handler priority runs,
    // whatever their display priority.
    registerHotkey({
      scopeId: view,
      hotkey: 'o',
      description: 'Open later',
      keyDownHandler: handler,
      registrationType: 'add',
      displayPriority: 10,
    });
    registerHotkey({
      scopeId: view,
      hotkey: 'o',
      description: 'Open now',
      keyDownHandler: handler,
      registrationType: 'add',
      handlerPriority: 3,
    });
  });

  const sheet = getShortcutSheet(view);
  expect(sheet.view).toContainEqual({
    description: 'Mark done',
    bindings: [['e']],
  });
  expect(sheet.view).toContainEqual({
    description: 'Open now',
    bindings: [['o']],
  });
  expect(sheet.view.map((entry) => entry.description)).not.toContain(
    'Open later'
  );
  expect(sheet.app).toContainEqual({
    description: 'Select',
    bindings: [['x']],
  });
});

test('runnable keys include hidden commands and only those whose condition holds', () => {
  const goTo = leaderScope('runnable-go-to');
  const [viewFocused, setViewFocused] = createSignal(false);
  createRoot((dispose) => {
    disposers.push(dispose);
    const handler = () => true;
    registerHotkey({
      scopeId: goTo,
      hotkey: 'h',
      description: 'Go to Home',
      keyDownHandler: handler,
      registrationType: 'add',
    });
    registerHotkey({
      scopeId: goTo,
      hotkey: 's',
      description: 'Go to Favorites',
      keyDownHandler: handler,
      condition: viewFocused,
      registrationType: 'add',
    });
    registerHotkey({
      scopeId: goTo,
      hotkey: 'g',
      description: 'Go to top',
      keyDownHandler: handler,
      hide: true,
      registrationType: 'add',
    });
  });

  expect([...getRunnableHotkeys(goTo)].sort()).toEqual(['g', 'h']);
  setViewFocused(true);
  expect([...getRunnableHotkeys(goTo)].sort()).toEqual(['g', 'h', 's']);
});
