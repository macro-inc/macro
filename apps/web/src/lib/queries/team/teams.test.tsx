import { toast } from '@core/component/Toast/Toast';
import { authServiceClient } from '@service-auth/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient as client } from '../client';
import { teamKeys } from './keys';
import { useCreateTeamWithInvitesMutation } from './teams';

const mocks = vi.hoisted(() => ({
  createTeam: vi.fn(),
  inviteToTeam: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
}));

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|owner@example.com',
}));

let dispose: (() => void) | undefined;
const team = { id: 'team-id', name: 'Example' };

function setup() {
  let mutation!: ReturnType<typeof useCreateTeamWithInvitesMutation>;
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        {(() => {
          mutation = useCreateTeamWithInvitesMutation();
          return null;
        })()}
      </QueryClientProvider>
    ),
    host
  );
  return mutation;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(authServiceClient, 'createTeam').mockImplementation(
    mocks.createTeam
  );
  vi.spyOn(authServiceClient, 'inviteToTeam').mockImplementation(
    mocks.inviteToTeam
  );
  vi.spyOn(toast, 'success').mockImplementation(mocks.success);
  vi.spyOn(toast, 'failure').mockImplementation(mocks.failure);
  client.clear();
  client.setDefaultOptions({
    mutations: { retry: false },
    queries: { retry: false },
  });
  client.setQueryData(teamKeys.userTeams.queryKey, []);
  mocks.createTeam.mockResolvedValue(ok(team));
  mocks.inviteToTeam.mockResolvedValue(ok(undefined));
});
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
  client.clear();
  document.body.replaceChildren();
});

describe('creating a team with invitations', () => {
  it('keeps the form pending until invitations finish', async () => {
    let finishInvites!: () => void;
    mocks.inviteToTeam.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishInvites = () => resolve(ok(undefined));
        })
    );
    const mutation = setup();
    const pending = mutation.mutateAsync({
      name: 'Example',
      invites: [{ email: 'ada@example.com' }],
    });
    await vi.waitFor(() => expect(mocks.inviteToTeam).toHaveBeenCalledTimes(1));
    expect(client.getQueryData(teamKeys.userTeams.queryKey)).toEqual([]);
    expect(mocks.success).not.toHaveBeenCalled();
    finishInvites();
    await pending;
    expect(mocks.success).toHaveBeenCalledWith(
      'Team created and invitations sent'
    );
  });

  it('preserves the created team and reports invitation failure without claiming success', async () => {
    mocks.inviteToTeam.mockRejectedValue(new Error('Unavailable'));
    const mutation = setup();
    await expect(
      mutation.mutateAsync({
        name: 'Example',
        invites: [{ email: 'ada@example.com' }],
      })
    ).rejects.toThrow('Your team was created');
    expect(client.getQueryData(teamKeys.userTeams.queryKey)).toEqual([team]);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.failure).toHaveBeenCalledWith(
      expect.stringContaining('Retry from Team settings')
    );
  });

  it('sends no invitations when the user opts out', async () => {
    const mutation = setup();
    await mutation.mutateAsync({ name: 'Example', invites: [] });
    expect(mocks.inviteToTeam).not.toHaveBeenCalled();
    expect(mocks.success).toHaveBeenCalledWith('Team created');
  });
});
