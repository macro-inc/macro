import { GO_TO_COMMAND_SCOPE } from '@app/constants/hotkeys';
import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import { isScopeInActiveBranch } from '@core/hotkey/utils';
import { MutationUndoProvider, useMutationUndoContext } from '@queries/undo';
import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { EmailTab } from './constants';
import { registerGoToSentHotkey } from './go-to-sent';
import { useEmailViewHotkeys } from './use-email-view-hotkeys';

afterEach(() => setActiveScope('global'));

function press(key: string, init: KeyboardEventInit = {}) {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, ...init })
  );
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function setup(initialTab: EmailTab = 'noise') {
  const goHome = vi.fn(() => true);
  const goToTasks = vi.fn(() => true);
  const openSent = vi.fn(() => true);
  const goToToday = vi.fn(() => true);
  const openCreateMenu = vi.fn(() => true);
  const [tab, setTab] = createSignal<EmailTab>(initialTab);
  let pushUndo!: ReturnType<typeof useMutationUndoContext>['pushUndo'];

  function Harness() {
    useHotKeyRoot();
    const [attachEmail, emailScope] = useHotkeyDOMScope('email-split');
    // The reading pane: a child scope, as in EmailReader.
    const [attachReader, readerScope] = useHotkeyDOMScope('email-reader');
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
    // The app-wide Create menu, registered by GlobalHotkeys.
    registerHotkey({
      hotkey: 'c',
      scopeId: 'global',
      description: 'Create',
      keyDownHandler: openCreateMenu,
    });
    const registerHome = () =>
      registerHotkey({
        hotkey: ['h', 'i'],
        scopeId: GO_TO_COMMAND_SCOPE,
        description: 'Go to Home',
        keyDownHandler: goHome,
        registrationType: 'add',
      });
    registerHome();
    registerHotkey({
      hotkey: 't',
      scopeId: GO_TO_COMMAND_SCOPE,
      description: 'Go to Tasks',
      keyDownHandler: goToTasks,
      registrationType: 'add',
    });
    registerGoToSentHotkey(openSent);
    const [attachCalendar, calendarScope] = useHotkeyDOMScope('calendar-split');
    registerHotkey({
      hotkey: 't',
      scopeId: calendarScope,
      description: 'Go to today',
      keyDownHandler: goToToday,
    });
    useEmailViewHotkeys({
      scopeId: emailScope,
      enabled: () => true,
      tab,
      setTab,
      listHasKeyboard: () => !isScopeInActiveBranch(readerScope),
      hasSelection: () => false,
    });
    // Flags loading later re-register the sidebar's letters.
    registerHome();
    return (
      <div ref={(element) => attachGlobalDOMScope(element)}>
        <div ref={attachEmail} tabIndex={0} data-testid="email">
          <div ref={attachReader} tabIndex={0} data-testid="reader" />
        </div>
        <button type="button">Elsewhere</button>
        <div ref={attachCalendar} tabIndex={0} data-testid="calendar" />
      </div>
    );
  }

  const view = render(() => (
    <MutationUndoProvider>
      <Harness />
    </MutationUndoProvider>
  ));
  return {
    view,
    goHome,
    goToTasks,
    openSent,
    goToToday,
    openCreateMenu,
    tab,
    pushUndo: () => pushUndo,
  };
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

it('leaves g h to Home inside Email', () => {
  const { view, goHome, tab } = setup();
  view.getByTestId('email').focus();

  press('g');
  press('h');
  expect(goHome).toHaveBeenCalledOnce();
  expect(tab()).toBe('noise');
});

it('returns to Signal on Escape and leaves c to the Create menu', () => {
  const { view, openCreateMenu, tab } = setup('archived');
  view.getByTestId('email').focus();

  press('Escape');
  expect(tab()).toBe('important');
  press('c');
  expect(openCreateMenu).toHaveBeenCalledOnce();
});

it('undoes the latest action with z', () => {
  const { view, pushUndo } = setup();
  const undo = vi.fn();
  pushUndo()({ undo });
  view.getByTestId('email').focus();

  press('z');
  expect(undo).toHaveBeenCalledOnce();
});

it('undoes once while z is held', () => {
  const { view, pushUndo } = setup();
  const first = vi.fn();
  const second = vi.fn();
  pushUndo()({ undo: first });
  pushUndo()({ undo: second });
  view.getByTestId('email').focus();

  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', bubbles: true })
  );
  press('z', { repeat: true });
  expect(second).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled();
});

it('works from the reading pane, where Escape stays with the reader', () => {
  const { view, openCreateMenu, openSent, goToTasks, tab, pushUndo } =
    setup('archived');
  const undo = vi.fn();
  pushUndo()({ undo });
  view.getByTestId('reader').focus();

  press('Escape');
  expect(tab()).toBe('archived');
  press('c');
  expect(openCreateMenu).toHaveBeenCalledOnce();
  press('z');
  expect(undo).toHaveBeenCalledOnce();
  press('g');
  press('t');
  expect(goToTasks).toHaveBeenCalledOnce();
  expect(openSent).not.toHaveBeenCalled();
  expect(tab()).toBe('archived');
});

it('opens Tasks with g t from Email and from Calendar', () => {
  const { view, goToTasks, goToToday, openSent, tab } = setup();

  view.getByTestId('email').focus();
  press('g');
  press('t');
  expect(goToTasks).toHaveBeenCalledOnce();
  expect(tab()).toBe('noise');

  view.getByTestId('calendar').focus();
  press('g');
  press('t');
  expect(goToTasks).toHaveBeenCalledTimes(2);
  expect(goToToday).not.toHaveBeenCalled();
  expect(openSent).not.toHaveBeenCalled();
});

it('opens Sent with g s from Email and from Calendar', () => {
  const { view, openSent, goToTasks, tab } = setup();

  view.getByTestId('email').focus();
  press('g');
  press('s');
  expect(openSent).toHaveBeenCalledOnce();
  expect(tab()).toBe('noise');

  view.getByTestId('calendar').focus();
  press('g');
  press('s');
  expect(openSent).toHaveBeenCalledTimes(2);
  expect(goToTasks).not.toHaveBeenCalled();
});
