import { GO_TO_COMMAND_SCOPE } from '@app/constants/hotkeys';
import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  HotkeyProfilesProvider,
  type HotkeyProfilesSource,
} from '../context/hotkey-profiles-context';
import type { HotkeyProfile, HotkeyProfileId } from '../core/profiles';
import { useHotkeyProfile } from './use-hotkey-profile';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

afterEach(() => setActiveScope('global'));

const MARK_UNREAD = 'profile-test.markUnread' as HotkeyToken;
const MARK_READ = 'profile-test.markRead' as HotkeyToken;

const PROFILE = {
  id: 'superhuman',
  domain: 'email',
  label: () => 'Test profile',
  toggleLabel: () => 'Test profile in Email',
  toggleDescription: () => 'Test keys',
  bindings: [
    {
      section: () => 'Messages',
      keys: ['c'],
      description: () => 'Compose',
      target: { action: 'compose' },
    },
    {
      section: () => 'Folders',
      keys: [['g', 'h']],
      description: () => 'Go to Reminders',
      target: { action: 'showReminders' },
    },
    {
      section: () => 'Conversations',
      keys: ['u'],
      description: () => 'Mark read or unread',
      target: { tokens: [MARK_UNREAD, MARK_READ], contexts: ['view'] },
    },
    {
      section: () => 'Issue actions',
      keys: [['m', 'b']],
      description: () => 'Set what it depends on',
      target: { action: 'setDependsOn' },
    },
  ],
  sameKeys: [],
} as const satisfies HotkeyProfile<
  'compose' | 'showReminders' | 'setDependsOn'
>;

function press(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function setup() {
  const ran: string[] = [];
  const record = (name: string) => () => {
    ran.push(name);
    return true;
  };
  const [active, setActive] = createSignal<HotkeyProfileId | undefined>(
    'superhuman'
  );
  const [unread, setUnread] = createSignal(false);
  const [hasThread, setHasThread] = createSignal(true);
  const source: HotkeyProfilesSource = {
    activeProfile: (domain) => (domain === 'email' ? active() : undefined),
    ready: () => true,
    setProfile: () => {},
  };

  function Harness() {
    useHotKeyRoot();
    const [attachView, viewScope] = useHotkeyDOMScope('profile-view');
    registerHotkey({
      hotkey: 'g',
      scopeId: 'global',
      description: 'Go to',
      keyDownHandler: () => true,
      activateCommandScopeId: GO_TO_COMMAND_SCOPE,
      registrationType: 'add',
      hide: true,
    });
    registerHotkey({
      hotkey: 'h',
      scopeId: GO_TO_COMMAND_SCOPE,
      description: 'Go to Home',
      keyDownHandler: record('home'),
      registrationType: 'add',
    });
    registerHotkey({
      hotkey: 'c',
      scopeId: 'global',
      description: 'Create menu',
      keyDownHandler: record('create menu'),
    });
    registerHotkey({
      hotkey: 'u',
      scopeId: 'global',
      description: 'Elsewhere u',
      keyDownHandler: record('elsewhere u'),
    });
    registerHotkey({
      hotkey: 'm',
      scopeId: viewScope,
      description: 'Move to folder',
      keyDownHandler: record('move'),
    });
    registerHotkey({
      hotkey: 'u',
      hotkeyToken: MARK_UNREAD,
      scopeId: viewScope,
      description: 'Mark as unread',
      condition: () => hasThread() && !unread(),
      keyDownHandler: () => {
        ran.push('unread');
        setUnread(true);
        return true;
      },
    });
    registerHotkey({
      hotkey: 'shift+u',
      hotkeyToken: MARK_READ,
      scopeId: viewScope,
      description: 'Mark as read',
      condition: () => hasThread() && unread(),
      keyDownHandler: () => {
        ran.push('read');
        setUnread(false);
        return true;
      },
    });
    useHotkeyProfile(PROFILE, {
      context: 'view',
      scopeId: viewScope,
      enabled: () => true,
      actions: {
        compose: record('compose'),
        showReminders: record('reminders'),
        setDependsOn: record('depends on'),
      },
    });
    return (
      <div ref={(element) => attachGlobalDOMScope(element)}>
        <div ref={attachView} tabIndex={0} data-testid="view" />
        <button type="button">Elsewhere</button>
      </div>
    );
  }

  const view = render(() => (
    <HotkeyProfilesProvider value={source}>
      <Harness />
    </HotkeyProfilesProvider>
  ));
  return { view, ran, setActive, setHasThread };
}

it("runs the profile's keys while it is on and Macro's once it is turned off", () => {
  const { view, ran, setActive } = setup();
  view.getByTestId('view').focus();

  press('c');
  press('m');
  press('b');
  setActive(undefined);
  press('c');
  press('m');

  expect(ran).toEqual(['compose', 'depends on', 'create menu', 'move']);
});

it('runs a profile go-to letter only after g was pressed in its view', () => {
  const { view, ran } = setup();
  view.getByTestId('view').focus();
  press('g');
  press('h');

  view.getByRole('button', { name: 'Elsewhere' }).focus();
  press('g');
  press('h');
  press('c');

  expect(ran).toEqual(['reminders', 'home', 'create menu']);
});

it('runs whichever aliased action can run, and lets the key through when none can', () => {
  const { view, ran, setHasThread } = setup();
  view.getByTestId('view').focus();

  press('u');
  press('u');
  setHasThread(false);
  press('u');

  expect(ran).toEqual(['unread', 'read', 'elsewhere u']);
});
