import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { HOTKEY_SCOPE_NEUTRAL_DATA_ATTRIBUTE } from '../dom-selectors';
import { attachGlobalDOMScope, useHotkeyDOMScope } from './hotkeys';
import { activeScope, setActiveScope } from './state';

let container: HTMLDivElement;
let scopeEl: HTMLDivElement;
let neutralButton: HTMLButtonElement;
let plainButton: HTMLButtonElement;
let scopeId: string;
let disposeRoot: () => void;

const focusIn = (el: Element) => {
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);

  scopeEl = document.createElement('div');

  const neutralZone = document.createElement('div');
  neutralZone.setAttribute(HOTKEY_SCOPE_NEUTRAL_DATA_ATTRIBUTE, '');
  neutralButton = document.createElement('button');
  neutralZone.appendChild(neutralButton);

  plainButton = document.createElement('button');

  container.append(scopeEl, neutralZone, plainButton);

  disposeRoot = createRoot((dispose) => {
    attachGlobalDOMScope(container);
    const [attachHotkeys, id] = useHotkeyDOMScope('scope-activation-test');
    attachHotkeys(scopeEl);
    scopeId = id;
    return dispose;
  });
});

afterEach(() => {
  disposeRoot();
  container.remove();
  setActiveScope('global');
});

describe('scope activation on focusin', () => {
  test('focus inside a DOM scope activates it', () => {
    focusIn(scopeEl);
    expect(activeScope()).toBe(scopeId);
  });

  test('focus in a neutral region keeps the current scope active', () => {
    focusIn(scopeEl);
    expect(activeScope()).toBe(scopeId);

    focusIn(neutralButton);
    expect(activeScope()).toBe(scopeId);

    // The neutral focusin must not leave the inner-scope-claimed flag set:
    // the next unscoped focus still falls through to global.
    focusIn(plainButton);
    expect(activeScope()).toBe('global');
  });

  test('focus outside scopes and neutral regions falls through to global', () => {
    focusIn(scopeEl);
    expect(activeScope()).toBe(scopeId);

    focusIn(plainButton);
    expect(activeScope()).toBe('global');
  });

  // The sidebar account-menu flow: opening the menu moves focus into a body
  // portal (unscoped → 'global'), closing it returns focus to the trigger in
  // the neutral sidebar. Preserving the decayed 'global' scope would leave
  // split hotkeys dead until the user clicks back into a split.
  test('returning to a neutral region after the scope decayed to global restores the last live scope', () => {
    focusIn(scopeEl);
    focusIn(plainButton);
    expect(activeScope()).toBe('global');

    focusIn(neutralButton);
    expect(activeScope()).toBe(scopeId);
  });

  // The sidebar create-menu flow: the launcher owns its own scope, which is
  // removed when it closes — so the most recent scope is dead and the one
  // before it is the scope to restore.
  test('restores the previous live scope when the last active scope was removed', () => {
    focusIn(scopeEl);

    let scopeBId = '';
    const scopeBEl = document.createElement('div');
    container.appendChild(scopeBEl);
    const disposeB = createRoot((dispose) => {
      const [attachHotkeys, id] = useHotkeyDOMScope('scope-activation-test-b');
      attachHotkeys(scopeBEl);
      scopeBId = id;
      return dispose;
    });

    focusIn(scopeBEl);
    expect(activeScope()).toBe(scopeBId);

    disposeB();
    scopeBEl.remove();
    expect(activeScope()).toBe('global');

    focusIn(neutralButton);
    expect(activeScope()).toBe(scopeId);
  });
});
