/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Leftover } from '../../settings/connections/model';
import { AgentComposerAddMenu } from './ComposerAddMenu';

const [savedConnection, setSavedConnection] = createSignal<Leftover>({
  kind: 'pipedream',
  id: 'pd-slack',
  title: 'Slack workspace',
  subtitle: 'Slack',
  appSlug: 'slack_v2',
  enabled: false,
});

const state = vi.hoisted(() => ({
  mobile: false,
  ready: true,
  failed: false,
  retry: vi.fn(),
}));
vi.mock('@core/constant/settingsTabsConfig', () => ({
  useSettingsTabAvailable: () => () => true,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => state.mobile }));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: vi.fn() }),
}));
vi.mock('../../settings/connections/use-connections-model', () => ({
  useConnectionsModel: () => ({
    ready: () => state.ready,
    partialError: () => state.failed,
    retry: state.retry,
    model: () => ({
      capabilities: [
        {
          id: 'github-ai',
          provider: 'github',
          title: 'GitHub',
          status: 'connected',
          account: 'My account',
        },
      ],
      leftovers: [savedConnection()],
    }),
  }),
}));
vi.mock('../../settings/connections/integrations-view', () => ({
  IntegrationsView: (props: { initialProvider?: string }) => (
    <p>
      {props.initialProvider
        ? `Settings for ${props.initialProvider}`
        : 'Available integrations'}
    </p>
  ),
}));
vi.mock('../../settings/connections/leftover-row', () => ({
  LeftoverRow: (props: { leftover: Leftover }) => (
    <p>
      Saved Slack connection settings:{' '}
      {props.leftover.enabled ? 'enabled' : 'disabled'}
    </p>
  ),
}));

const originalScrollTo = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollTo'
);
beforeEach(() => {
  setSavedConnection({
    kind: 'pipedream',
    id: 'pd-slack',
    title: 'Slack workspace',
    subtitle: 'Slack',
    appSlug: 'slack_v2',
    enabled: false,
  });
  state.mobile = false;
  state.ready = true;
  state.failed = false;
  vi.clearAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  if (originalScrollTo)
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
  vi.unstubAllGlobals();
});
function setup() {
  const actions = {
    openFiles: vi.fn(),
    openLibrary: vi.fn(),
    openSkills: vi.fn(),
  };
  render(() => (
    <>
      <style>
        {'[role="menu"] {animation-name:none;transition-duration:0s}'}
      </style>
      <AgentComposerAddMenu {...actions} getEditor={() => null} />
    </>
  ));
  const trigger = screen.getByRole('button', { name: /^Add$/ });
  if (state.mobile) fireEvent.click(trigger);
  else fireEvent.keyDown(trigger, { key: 'Enter' });
  return actions;
}

it('keeps uploads available through the richer menu', () => {
  const actions = setup();
  fireEvent.keyDown(
    screen.getByRole('menuitem', { name: /Add photos & files/ }),
    { key: 'Enter' }
  );
  expect(actions.openFiles).toHaveBeenCalledOnce();
});
it.each([
  ['Add from library', 'openLibrary'],
  ['Use a skill', 'openSkills'],
] as const)('returns focus before running %s', async (label, action) => {
  const actions = setup();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: new RegExp(label) }), {
    key: 'Enter',
  });
  await waitFor(() => expect(actions[action]).toHaveBeenCalledOnce());
  expect(screen.queryByRole('menu')).toBeNull();
});
it('opens the selected provider settings without inserting a prompt', async () => {
  const actions = setup();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: /GitHub/ }), {
    key: 'Enter',
  });
  expect(await screen.findByText('Settings for github')).toBeTruthy();
  expect(actions.openLibrary).not.toHaveBeenCalled();
  expect(actions.openSkills).not.toHaveBeenCalled();
});
it('opens a disabled connection for management', async () => {
  setup();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: /Slack workspace/ }), {
    key: 'Enter',
  });
  expect(
    await screen.findByText('Saved Slack connection settings: disabled')
  ).toBeTruthy();
});
it('opens the unified catalog for Add connections', async () => {
  setup();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: /Add connections/ }), {
    key: 'Enter',
  });
  expect(await screen.findByText('Available integrations')).toBeTruthy();
});
it('offers retry without hiding the main actions when a source fails', () => {
  state.failed = true;
  setup();
  fireEvent.keyDown(
    screen.getByRole('menuitem', { name: /Retry connections/ }),
    { key: 'Enter' }
  );
  expect(state.retry).toHaveBeenCalledOnce();
});
it('offers the same actions in the mobile sheet', async () => {
  state.mobile = true;
  const actions = setup();
  fireEvent.click(
    await screen.findByRole('button', { name: /Add from library/ })
  );
  expect(actions.openLibrary).toHaveBeenCalledOnce();
});

it('refreshes an open connection when the query returns its updated state', async () => {
  setup();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: /Slack workspace/ }), {
    key: 'Enter',
  });
  await screen.findByText('Saved Slack connection settings: disabled');
  setSavedConnection((connection) => ({ ...connection, enabled: true }));
  expect(
    await screen.findByText('Saved Slack connection settings: enabled')
  ).toBeTruthy();
});

it('hands the mobile sheet off to connection settings', async () => {
  state.mobile = true;
  setup();
  fireEvent.click(await screen.findByRole('button', { name: /GitHub/ }));
  expect(await screen.findByText('Settings for github')).toBeTruthy();
});
