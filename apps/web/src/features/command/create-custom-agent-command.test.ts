/** @vitest-environment jsdom */
import { registerHotkey, useHotKeyRoot } from '@core/hotkey/hotkeys';
import { setActiveScope, setPressedKeys } from '@core/hotkey/state';
import { registerScope, removeScope } from '@core/hotkey/utils';
import { fireEvent } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createCustomAgentCommand } from './create-custom-agent-command';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

const disposers: (() => void)[] = [];
const scope = 'test-create-custom-agent';

function setup() {
  const actions = { close: vi.fn(), open: vi.fn() };
  const command = createCustomAgentCommand(actions);
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
    registerHotkey({ ...command, scopeId: scope });
  });
  setActiveScope('global');
  return actions;
}

function press(key: string, target: Element | Document = document) {
  fireEvent.keyDown(target, { key });
  fireEvent.keyUp(target, { key });
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  removeScope(scope);
  setActiveScope('global');
  setPressedKeys(new Set<string>());
  document.body.replaceChildren();
});

it('uses C W to close Create and open the new-agent wizard once', () => {
  const actions = setup();
  press('c');
  press('w');
  expect(actions.close).toHaveBeenCalledOnce();
  expect(actions.open).toHaveBeenCalledOnce();
  expect(actions.close.mock.invocationCallOrder[0]).toBeLessThan(
    actions.open.mock.invocationCallOrder[0]
  );
});

it('does not open the wizard while typing', () => {
  const actions = setup();
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  setActiveScope(scope);
  press('w', input);
  expect(actions.open).not.toHaveBeenCalled();
});
