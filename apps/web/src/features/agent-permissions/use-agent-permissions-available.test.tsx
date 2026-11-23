/**
 * @vitest-environment jsdom
 */

import { queryClient } from '@queries/client';
import { render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentToolPermissionKeys } from './queries/keys';
import { VIEW } from './tests/fixtures';
import { useAgentPermissionsAvailable } from './use-agent-permissions-available';

const client = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@service-agent-harness/tool-permissions', () => ({
  toolPermissionsClient: client,
}));
const flag = vi.hoisted(() => ({ on: true }));
vi.mock('./use-agent-permissions-flag', () => ({
  useAgentPermissionsFlag: () => () => flag.on,
}));

function Probe() {
  const available = useAgentPermissionsAvailable(() => 'agent-1');
  return <p>{available() ? 'shown' : 'hidden'}</p>;
}

function renderProbe() {
  render(() => (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  ));
}

beforeEach(() => {
  queryClient.clear();
  client.get.mockReset();
  flag.on = true;
});

describe('useAgentPermissionsAvailable', () => {
  it('shows once the API has the agent’s permissions', async () => {
    client.get.mockResolvedValue(ok(VIEW));
    renderProbe();
    expect(screen.getByText('hidden')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('shown')).toBeTruthy());
  });

  it('hides when the API answers 404', async () => {
    client.get.mockResolvedValue(
      err([{ code: 'NOT_FOUND', message: 'Resource not found' }])
    );
    renderProbe();
    await waitFor(() =>
      expect(
        queryClient.getQueryData(
          agentToolPermissionKeys.agent('agent-1').queryKey
        )
      ).toBeNull()
    );
    expect(screen.getByText('hidden')).toBeTruthy();
  });

  it('hides and asks nothing while the flag is off', () => {
    flag.on = false;
    renderProbe();
    expect(screen.getByText('hidden')).toBeTruthy();
    expect(client.get).not.toHaveBeenCalled();
  });
});
