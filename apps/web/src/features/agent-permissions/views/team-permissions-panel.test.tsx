/**
 * @vitest-environment jsdom
 */

import { queryClient } from '@queries/client';
import type { TeamToolPermissions } from '@service-agent-harness/generated/schemas';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { Suspense } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTITY_CATALOG, ENTITY_VIEW } from '../tests/fixtures';
import { TeamPermissionsPanel } from './team-permissions-panel';

const client = vi.hoisted(() => ({
  catalog: vi.fn(),
  team: vi.fn(),
  setTeam: vi.fn(),
  resetTeam: vi.fn(),
}));
vi.mock('@service-agent-harness/tool-permissions', () => ({
  TOOL_PERMISSION_REFUSED: 'TOOL_PERMISSION_REFUSED',
  toolPermissionsClient: client,
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), failure: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({ toast: toasts }));

const TEAM_VIEW: TeamToolPermissions = {
  teamId: 'team-1',
  policyId: 'policy-team',
  kind: 'team',
  canEdit: true,
  version: ENTITY_VIEW.version,
  restricted: ENTITY_VIEW.restricted,
  defaults: ENTITY_VIEW.defaults,
  groups: ENTITY_VIEW.groups,
  rules: ENTITY_VIEW.rules,
};

function option(control: string, state: 'Allow' | 'Ask' | 'Never') {
  return within(screen.getByRole('radiogroup', { name: control })).getByRole(
    'radio',
    { name: state }
  );
}

function renderPanel(view: TeamToolPermissions) {
  client.catalog.mockResolvedValue(ok(ENTITY_CATALOG));
  client.team.mockResolvedValue(ok(view));
  client.setTeam.mockResolvedValue(ok(view));
  render(() => (
    <QueryClientProvider client={queryClient}>
      <Suspense>
        <TeamPermissionsPanel teamId="team-1" />
      </Suspense>
    </QueryClientProvider>
  ));
}

beforeEach(() => {
  queryClient.clear();
  for (const mock of Object.values(client)) mock.mockReset();
});

describe('TeamPermissionsPanel', () => {
  it("saves an admin's change to the team default", async () => {
    renderPanel(TEAM_VIEW);
    await screen.findByRole('radiogroup', { name: 'Read default permission' });
    fireEvent.click(option('Read default permission', 'Ask'));
    await waitFor(() => expect(client.setTeam).toHaveBeenCalledTimes(1));
    expect(client.setTeam.mock.calls[0]?.slice(0, 2)).toEqual([
      'team-1',
      {
        changes: [{ target: { kind: 'action', action: 'read' }, state: 'ask' }],
      },
    ]);
    expect(
      screen.getByRole('button', { name: 'Reset permissions' })
    ).toBeTruthy();
  });

  it('says resetting the team default changes the agents following it', async () => {
    renderPanel(TEAM_VIEW);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Reset permissions' })
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(
      'Agents that follow these permissions change too.'
    );
  });

  it('is read-only for a member', async () => {
    renderPanel({ ...TEAM_VIEW, canEdit: false });
    await screen.findByRole('radiogroup', { name: 'Read default permission' });
    expect(
      (option('Read default permission', 'Ask') as HTMLInputElement).disabled
    ).toBe(true);
    expect(
      screen.getByText('Only team admins and owners can change these.')
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Reset permissions' })
    ).toBeNull();
  });
});
