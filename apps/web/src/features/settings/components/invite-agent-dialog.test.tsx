import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { DEV } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@service-auth/client', () => ({
  authServiceClient: {
    getTeamAgentSizes: vi.fn(),
    quoteTeamAgent: vi.fn(),
  },
}));

import { queryClient } from '@queries/client';
import { authServiceClient } from '@service-auth/client';
import { InviteAgentDialog } from './invite-agent-dialog';

const quote = {
  included: false,
  seat: 2000,
  computer: 3000,
  total: 5000,
  currency: 'usd',
  vcpus: 4,
  memoryGb: 8,
  diskGb: 100,
  interval: 'month' as const,
};

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

it('bounds reactive updates while typing and only requests a quote when size changes', async () => {
  queryClient.clear();
  vi.mocked(authServiceClient.getTeamAgentSizes).mockResolvedValue(
    ok({
      sizes: [
        { size: 'standard', vcpus: 4, memoryGb: 8, diskGb: 100 },
        { size: 'large', vcpus: 8, memoryGb: 16, diskGb: 200 },
        { size: 'xl', vcpus: 16, memoryGb: 32, diskGb: 400 },
      ],
    })
  );
  vi.mocked(authServiceClient.quoteTeamAgent).mockResolvedValue(ok(quote));
  render(() => (
    <QueryClientProvider client={queryClient}>
      <InviteAgentDialog teamId="team-1" open onClose={() => {}} />
    </QueryClientProvider>
  ));
  await waitFor(() =>
    expect(screen.getByText('4 vCPUs · 8 GB RAM · 100 GB disk')).toBeTruthy()
  );
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));

  const updates = vi.fn();
  if (!DEV) throw new Error('Solid development hooks are required');
  const previousUpdate = DEV.hooks.afterUpdate;
  DEV.hooks.afterUpdate = updates;
  const dialog = screen.getByRole('dialog');
  const fields = [
    screen.getByLabelText('Name'),
    screen.getByLabelText('Role / job description'),
    screen.getByLabelText('Personality'),
    screen.getByLabelText('Avatar URL (optional)'),
  ];
  let queryUpdates = 0;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'updated') queryUpdates++;
  });
  try {
    for (const field of fields) {
      for (const value of ['a', 'ab', 'abc', 'abcd', 'abcde']) {
        fireEvent.input(field, { target: { value } });
        expect(field.isConnected).toBe(true);
      }
    }
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(updates.mock.calls.length).toBeLessThanOrEqual(100);
    expect(queryUpdates).toBe(0);
    expect(authServiceClient.getTeamAgentSizes).toHaveBeenCalledTimes(1);
    expect(authServiceClient.quoteTeamAgent).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('radio', { name: /large/i }));
    await waitFor(() =>
      expect(authServiceClient.quoteTeamAgent).toHaveBeenCalledTimes(2)
    );
    expect(authServiceClient.quoteTeamAgent).toHaveBeenLastCalledWith('large');
    expect(authServiceClient.getTeamAgentSizes).toHaveBeenCalledTimes(1);
  } finally {
    DEV.hooks.afterUpdate = previousUpdate;
    unsubscribe();
  }
});
