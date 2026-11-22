/**
 * @vitest-environment jsdom
 */

import { queryClient } from '@queries/client';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionsView } from '../queries/permissions-view';
import { CATALOG, VIEW } from '../tests/fixtures';
import { ShowPermissionsCard } from './show-permissions-card';

const client = vi.hoisted(() => ({
  catalog: vi.fn(),
  session: vi.fn(),
  set: vi.fn(),
}));
vi.mock('@service-agent-harness/tool-permissions', () => ({
  TOOL_PERMISSION_REFUSED: 'TOOL_PERMISSION_REFUSED',
  toolPermissionsClient: client,
}));

const settings = vi.hoisted(() => ({ openSettingsInSplit: vi.fn() }));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => settings,
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), failure: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({ toast: toasts }));

function renderCard(view: PermissionsView = VIEW) {
  client.catalog.mockResolvedValue(ok(CATALOG));
  client.session.mockResolvedValue(ok(view));
  return render(() => (
    <QueryClientProvider client={queryClient}>
      <Suspense>
        <ShowPermissionsCard
          sessionId="session-1"
          agentName="Scout"
          selection={{
            groups: [{ group: 'email', actions: ['send'] }],
            tools: [{ service: 'email', operation: 'send_message' }],
          }}
          reason="I need to send the weekly report."
        />
      </Suspense>
    </QueryClientProvider>
  ));
}

function option(control: string, state: 'Allow' | 'Ask' | 'Deny') {
  return within(screen.getByRole('radiogroup', { name: control })).getByRole(
    'radio',
    { name: state }
  );
}

beforeEach(() => {
  queryClient.clear();
  client.set.mockResolvedValue(ok(VIEW));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ShowPermissionsCard', () => {
  it('shows only what the agent asked about, with its reason', async () => {
    renderCard();
    expect(
      await screen.findByRole('radiogroup', { name: 'Email: Send' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('radiogroup', { name: 'Email: Read' })
    ).toBeNull();
    expect(
      screen.getByRole('radiogroup', { name: 'Send message' })
    ).toBeTruthy();
    expect(
      screen.getByText('“I need to send the weekly report.”')
    ).toBeTruthy();
    expect(option('Email: Send', 'Ask')).toHaveProperty('checked', true);
    expect(
      screen.getByText('Changes save right away and apply to Scout everywhere.')
    ).toBeTruthy();
  });

  it('saves a change to the agent and reads the session again', async () => {
    renderCard();
    await screen.findByRole('radiogroup', { name: 'Email: Send' });
    fireEvent.click(option('Email: Send', 'Allow'));

    await waitFor(() =>
      expect(client.set).toHaveBeenCalledWith(
        'agent-1',
        {
          changes: [
            {
              target: { kind: 'group_action', group: 'email', action: 'send' },
              // Allow follows the (always) default: no explicit exception.
              state: null,
            },
          ],
        },
        expect.anything()
      )
    );
    await waitFor(() => expect(client.session).toHaveBeenCalledTimes(2));
  });

  it('opens the agent’s permissions page at the group', async () => {
    renderCard();
    fireEvent.click(
      await screen.findByRole('button', { name: 'All permissions' })
    );
    expect(settings.openSettingsInSplit).toHaveBeenCalledWith('Agents');
  });

  it('is read-only for someone who can’t edit the agent', async () => {
    renderCard({ ...VIEW, canEdit: false });
    await screen.findByRole('radiogroup', { name: 'Email: Send' });
    expect(
      screen.getByText('Only people who can edit Scout can change these.')
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'All permissions' })
    ).toBeNull();
    fireEvent.click(option('Email: Send', 'Deny'));
    expect(client.set).not.toHaveBeenCalled();
  });

  it('says so when permissions aren’t available', async () => {
    client.catalog.mockResolvedValue(ok(CATALOG));
    renderCard();
    client.session.mockReset();
    queryClient.clear();
    cleanup();
    client.session.mockResolvedValue(ok(null));
    render(() => (
      <QueryClientProvider client={queryClient}>
        <Suspense>
          <ShowPermissionsCard
            sessionId="session-2"
            agentName="Scout"
            selection={{ groups: [{ group: 'email' }], tools: [] }}
          />
        </Suspense>
      </QueryClientProvider>
    ));
    expect(
      await screen.findByText('Permissions aren’t available here.')
    ).toBeTruthy();
  });
});
