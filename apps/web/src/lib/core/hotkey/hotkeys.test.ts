import { Telemetry } from '@macro-inc/observability';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createHotkeyGroup, registerHotkey, useHotKeyRoot } from './hotkeys';
import { hotkeyTokenMap, setActiveScope, setPressedKeys } from './state';
import type { HotkeyToken } from './tokens';
import type { RegisterHotkeyReturn } from './types';
import { registerScope, removeScope } from './utils';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

const disposers: (() => void)[] = [];
const scopes: string[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  for (const scopeId of scopes.splice(0)) removeScope(scopeId);
  setActiveScope('global');
  setPressedKeys(new Set<string>());
  vi.restoreAllMocks();
});

const makeRegistration = (): RegisterHotkeyReturn => {
  const reg: RegisterHotkeyReturn = {
    dispose: vi.fn(),
    hotkey: () => undefined,
    withGroup: (group) => {
      group.add(reg);
      return reg;
    },
  };
  return reg;
};

describe('createHotkeyGroup', () => {
  test('add returns the registration unchanged', () => {
    const group = createHotkeyGroup();
    const reg = makeRegistration();
    expect(group.add(reg)).toBe(reg);
  });

  test('dispose disposes every added registration', () => {
    const group = createHotkeyGroup();
    const a = makeRegistration();
    const b = makeRegistration();
    group.add(a);
    group.add(b);

    group.dispose();

    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).toHaveBeenCalledTimes(1);
  });

  test('addDisposer runs arbitrary cleanup on dispose', () => {
    const group = createHotkeyGroup();
    const cleanup = vi.fn();
    group.addDisposer(cleanup);

    group.dispose();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('runs disposers in insertion order across add and addDisposer', () => {
    const group = createHotkeyGroup();
    const calls: string[] = [];

    const a = makeRegistration();
    (a.dispose as ReturnType<typeof vi.fn>).mockImplementation(() => {
      calls.push('a');
    });

    group.add(a);
    group.addDisposer(() => calls.push('mid'));

    const b = makeRegistration();
    (b.dispose as ReturnType<typeof vi.fn>).mockImplementation(() => {
      calls.push('b');
    });
    group.add(b);

    group.dispose();

    expect(calls).toEqual(['a', 'mid', 'b']);
  });

  test('dispose is idempotent — second call is a no-op', () => {
    const group = createHotkeyGroup();
    const reg = makeRegistration();
    const cleanup = vi.fn();

    group.add(reg);
    group.addDisposer(cleanup);

    group.dispose();
    group.dispose();

    expect(reg.dispose).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('withGroup routes through add', () => {
    const group = createHotkeyGroup();
    const reg = makeRegistration();

    reg.withGroup(group);
    group.dispose();

    expect(reg.dispose).toHaveBeenCalledTimes(1);
  });
});

// Chrome autofill dispatches trusted keydown/keyup events that carry no `key`.
describe('key events without a key', () => {
  test('are ignored instead of throwing or re-running a held hotkey', () => {
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', onError);
    const keyDownHandler = vi.fn(() => false);
    createRoot((dispose) => {
      disposers.push(dispose);
      useHotKeyRoot();
      registerHotkey({
        scopeId: 'global',
        hotkey: 'j',
        description: 'Down',
        keyDownHandler,
      });
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    document.dispatchEvent(new Event('keydown'));
    document.dispatchEvent(new Event('keyup'));
    window.removeEventListener('error', onError);

    expect(errors).toEqual([]);
    expect(keyDownHandler).toHaveBeenCalledTimes(1);
  });
});

describe('registering a token that is already registered', () => {
  const token = 'hotkeys-test:token' as HotkeyToken;

  function makeScope(scopeId: string) {
    registerScope({ parentScopeId: 'global', scopeId, type: 'dom' });
    scopes.push(scopeId);
  }

  function mount(scopeId: string, hotkey: 'j' | ['arrowdown', 'j']) {
    return createRoot((dispose) => {
      registerHotkey({
        scopeId,
        hotkeyToken: token,
        hotkey,
        description: 'Down',
        keyDownHandler: () => true,
      });
      return dispose;
    });
  }

  test('a remount in the same scope keeps one registration and does not warn', () => {
    const warn = vi.spyOn(Telemetry, 'warn');
    makeScope('hotkeys-test-remount');

    mount('hotkeys-test-remount', 'j')();
    disposers.push(mount('hotkeys-test-remount', 'j'));

    expect(hotkeyTokenMap().get(token)).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test('a remount that registers before the old instance cleans up replaces it', () => {
    const warn = vi.spyOn(Telemetry, 'warn');
    makeScope('hotkeys-test-overlap');

    const disposeOld = mount('hotkeys-test-overlap', 'j');
    disposers.push(mount('hotkeys-test-overlap', 'j'));
    disposeOld();

    expect(hotkeyTokenMap().get(token)).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test('the same token with other keys in another scope does not warn', () => {
    const warn = vi.spyOn(Telemetry, 'warn');
    makeScope('hotkeys-test-list');
    makeScope('hotkeys-test-detail');

    disposers.push(mount('hotkeys-test-list', ['arrowdown', 'j']));
    disposers.push(mount('hotkeys-test-detail', 'j'));

    expect(hotkeyTokenMap().get(token)).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  test('the same token with other keys in the same scope warns', () => {
    const warn = vi.spyOn(Telemetry, 'warn');
    makeScope('hotkeys-test-conflict');

    disposers.push(mount('hotkeys-test-conflict', ['arrowdown', 'j']));
    disposers.push(mount('hotkeys-test-conflict', 'j'));

    expect(warn).toHaveBeenCalledOnce();
  });
});
