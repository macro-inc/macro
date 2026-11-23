/**
 * @vitest-environment jsdom
 */

import { queryClient } from '@queries/client';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE_LABEL } from '../tests/gated-fixtures';
import { BlockedPermissionsNotice } from './blocked-permissions-notice';

// `enable-agent-permissions`, by test.
const flags = vi.hoisted(() => ({ permissions: true }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({
    enabled: flags.permissions,
    loading: false,
  }),
}));

const client = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('@service-agent-harness/tool-permissions', () => ({
  TOOL_PERMISSION_REFUSED: 'TOOL_PERMISSION_REFUSED',
  toolPermissionsClient: client,
}));

vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettingsInSplit: vi.fn() }),
}));

function renderNotice() {
  return render(() => (
    <QueryClientProvider client={queryClient}>
      <Suspense>
        <BlockedPermissionsNotice
          sessionId="session-1"
          agentName="Scout"
          operations={[DELETE_LABEL]}
        />
      </Suspense>
    </QueryClientProvider>
  ));
}

beforeEach(() => {
  queryClient.clear();
  flags.permissions = true;
  client.session.mockResolvedValue(
    ok({ agentId: 'agent-1', canEdit: true, groups: [], rules: [] })
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BlockedPermissionsNotice', () => {
  it('links to the agent’s permissions once they load', async () => {
    renderNotice();
    expect(
      await screen.findByRole('button', { name: 'Review permissions' })
    ).toBeTruthy();
    expect(client.session).toHaveBeenCalledWith('session-1');
  });

  it('says what was blocked without reading permissions while the flag is off', async () => {
    flags.permissions = false;
    renderNotice();
    expect(
      screen.getByRole('region', { name: 'Blocked by permissions' })
    ).toBeTruthy();
    await Promise.resolve();
    expect(client.session).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Review permissions' })
    ).toBeNull();
  });
});
