import { GO_TO_COMMAND_SCOPE } from '@app/constants/hotkeys';
import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import { MutationUndoProvider, useMutationUndoContext } from '@queries/undo';
import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { EmailTab } from './constants';
import { useEmailViewHotkeys } from './use-email-view-hotkeys';

afterEach(() => setActiveScope('global'));

function press(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function setup(initialTab: EmailTab = 'noise') {
  const goHome = vi.fn(() => true);
  const compose = vi.fn();
  const [tab, setTab] = createSignal<EmailTab>(initialTab);
  const undone = vi.fn();
  let pushUndo!: ReturnType<typeof useMutationUndoContext>['pushUndo'];

  function Harness() {
    useHotKeyRoot();
    const [attachEmail, emailScope] = useHotkeyDOMScope('email-split');
    pushUndo = useMutationUndoContext().pushUndo;
    // The app-wide go-to letter, registered by the sidebar.
    registerHotkey({
      hotkey: 'g',
      scopeId: 'global',
      description: 'Go to',
      keyDownHandler: () => true,
      activateCommandScopeId: GO_TO_COMMAND_SCOPE,
      registrationType: 'add',
      hide: true,
    });
    const registerHome = () =>
      registerHotkey({
        hotkey: 'i',
        scopeId: GO_TO_COMMAND_SCOPE,
        description: 'Go to Home',
        keyDownHandler: goHome,
        registrationType: 'add',
      });
    registerHome();
    useEmailViewHotkeys({
      scopeId: emailScope,
      enabled: () => true,
      tab,
      setTab,
      isTabAvailable: () => true,
      threadOpen: () => false,
      hasSelection: () => false,
      compose,
      readingPane: () => false,
      setReadingPane: () => {},
    });
    // Flags loading later re-register the sidebar's letters.
    registerHome();
    return (
      <div ref={(element) => attachGlobalDOMScope(element)}>
        <div ref={attachEmail} tabIndex={0} data-testid="email" />
        <button type="button">Elsewhere</button>
      </div>
    );
  }

  const view = render(() => (
    <MutationUndoProvider>
      <Harness />
    </MutationUndoProvider>
  ));
  return { view, goHome, compose, tab, undone, pushUndo: () => pushUndo };
}

it('goes to email tabs with g sequences only while Email is focused', () => {
  const { view, goHome, tab } = setup();
  view.getByTestId('email').focus();

  press('g');
  press('i');
  expect(tab()).toBe('important');
  expect(goHome).not.toHaveBeenCalled();

  view.getByRole('button', { name: 'Elsewhere' }).focus();
  press('g');
  press('i');
  expect(goHome).toHaveBeenCalledOnce();
});

it('returns to Signal on Escape and composes with c', () => {
  const { view, compose, tab } = setup('archived');
  view.getByTestId('email').focus();

  press('Escape');
  expect(tab()).toBe('important');
  press('c');
  expect(compose).toHaveBeenCalledOnce();
});

it('undoes the latest action with z', () => {
  const { view, pushUndo } = setup();
  const undo = vi.fn();
  pushUndo()({ undo });
  view.getByTestId('email').focus();

  press('z');
  expect(undo).toHaveBeenCalledOnce();
});
