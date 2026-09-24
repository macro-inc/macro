/** @vitest-environment jsdom */
import { registerHotkey, useHotKeyRoot } from '@core/hotkey/hotkeys';
import { setActiveScope, setPressedKeys } from '@core/hotkey/state';
import { registerScope, removeScope } from '@core/hotkey/utils';
import { fireEvent } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createCallCommand } from './create-call-command';

const flags = vi.hoisted(() => ({ calls: true }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

const disposers: (() => void)[] = [];
const scope = 'test-create-call';

function setup(enabled = () => flags.calls) {
  const actions = { close: vi.fn(), navigate: vi.fn() };
  const command = createCallCommand({ ...actions, enabled });
  const closeWithoutCall = vi.fn(() => true);
  registerScope({
    scopeId: scope,
    parentScopeId: 'global',
    type: 'command',
    activationKeys: ['c'],
  });
  createRoot((dispose) => {
    disposers.push(dispose);
    useHotKeyRoot();
    registerHotkey({
      scopeId: 'global',
      hotkey: 'c',
      description: 'Create',
      activateCommandScopeId: scope,
      keyDownHandler: () => true,
    });
    registerHotkey({ ...command, scopeId: scope, condition: command.enabled });
    registerHotkey({
      scopeId: scope,
      hotkey: 'c',
      description: 'Close Create',
      registrationType: 'add',
      condition: () => !enabled(),
      keyDownHandler: closeWithoutCall,
    });
  });
  setActiveScope('global');
  return { ...actions, command, closeWithoutCall };
}

function pressC(target: Element | Document = document) {
  fireEvent.keyDown(target, { key: 'c' });
  fireEvent.keyUp(target, { key: 'c' });
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  removeScope(scope);
  setActiveScope('global');
  setPressedKeys(new Set<string>());
  document.body.replaceChildren();
  flags.calls = true;
});

it('uses the C C sequence to close Create and navigate to call setup once', () => {
  const actions = setup();
  pressC();
  expect(actions.navigate).not.toHaveBeenCalled();
  pressC();
  expect(actions.close).toHaveBeenCalledOnce();
  expect(actions.navigate).toHaveBeenCalledExactlyOnceWith('/meet/new');
});

it('does not start a call while typing, including inside an active create scope', () => {
  const actions = setup();
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  pressC(input);
  pressC(input);
  setActiveScope(scope);
  pressC(input);
  expect(actions.navigate).not.toHaveBeenCalled();
  expect(actions.close).not.toHaveBeenCalled();
});

it('disables both keyboard and direct menu action when calls are unavailable', () => {
  flags.calls = false;
  const actions = setup();
  expect(actions.command.enabled?.()).toBe(false);
  pressC();
  pressC();
  expect(actions.command.keyDownHandler()).toBe(false);
  expect(actions.navigate).not.toHaveBeenCalled();
  expect(actions.closeWithoutCall).toHaveBeenCalledOnce();
});

it('enables C C after the flag resolves and blocks a stale action when revoked', () => {
  const [enabled, setEnabled] = createSignal(false);
  const actions = setup(enabled);
  pressC();
  pressC();
  expect(actions.navigate).not.toHaveBeenCalled();
  setEnabled(true);
  setActiveScope('global');
  pressC();
  pressC();
  expect(actions.navigate).toHaveBeenCalledExactlyOnceWith('/meet/new');
  setEnabled(false);
  expect(actions.command.keyDownHandler()).toBe(false);
  expect(actions.navigate).toHaveBeenCalledOnce();
});
