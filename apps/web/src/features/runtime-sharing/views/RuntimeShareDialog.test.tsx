import type { Harness, HarnessResident } from '@service-storage/client';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeShareDialog } from './RuntimeShareDialog';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  setGrant: vi.fn(),
  setTeamAccess: vi.fn(),
  grants: [] as { userId: string; accessLevel: 'edit' }[],
  residents: [] as HarnessResident[],
  requests: [] as unknown[],
}));

vi.mock('@ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ui')>()),
  confirmDialog: mocks.confirm,
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|owner@x.test',
}));
vi.mock('@core/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/user')>()),
  getDisplayName: () => 'someone',
}));
vi.mock('@entity/owner/owner-display', () => ({
  OwnerLabel: (props: { ownerId: string }) => <span>{props.ownerId}</span>,
}));
vi.mock('@app/features/access-requests/queries/source', () => ({
  createSharingSource: () => ({
    state: () => ({
      canReview: true,
      supportedLevels: ['edit'],
      requests: mocks.requests,
      pendingCount: mocks.requests.length,
    }),
    grants: () => mocks.grants,
    busy: () => false,
    error: () => undefined,
    setGrant: mocks.setGrant,
    resolve: vi.fn(),
  }),
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    isSuccess: true,
    data: {
      team: { id: 'team-1', name: 'Team One' },
      members: [
        { user_id: 'macro|owner@x.test' },
        { user_id: 'macro|alice@x.test' },
      ],
    },
  }),
}));
vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessResidentsQuery: () => ({
    isSuccess: true,
    get data() {
      return mocks.residents;
    },
  }),
  useSetHarnessTeamAccessMutation: () => ({
    isPending: false,
    mutateAsync: mocks.setTeamAccess,
  }),
}));

const harness = (overrides: Partial<Harness> = {}): Harness => ({
  allow_permission_bypass: false,
  id: '0198a4cc-e138-7670-a308-a6b766602732',
  kind: 'macrod',
  name: 'Mac mini',
  owner: { type: 'user', user_id: 'macro|owner@x.test' },
  access: 'owner',
  shared_team_ids: [],
  created_by: 'macro|owner@x.test',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  connected: true,
  last_connected_at: null,
  ...overrides,
});

function open(value: Harness) {
  const [isOpen, setOpen] = createSignal(true);
  return render(() => (
    <RuntimeShareDialog
      harness={value}
      open={isOpen()}
      onOpenChange={setOpen}
    />
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.grants = [];
  mocks.residents = [];
  mocks.requests = [];
  mocks.setGrant.mockResolvedValue(undefined);
  mocks.setTeamAccess.mockResolvedValue(undefined);
});

describe('RuntimeShareDialog', () => {
  it('offers teammates, at the one level a runtime has', async () => {
    open(harness());
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(mocks.setGrant).toHaveBeenCalledWith('macro|alice@x.test', 'edit')
    );
  });

  it('removes access without asking when no resident depends on it', async () => {
    mocks.grants = [{ userId: 'macro|alice@x.test', accessLevel: 'edit' }];
    open(harness());
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(mocks.setGrant).toHaveBeenCalledWith('macro|alice@x.test', null)
    );
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('warns that removing a resident owner shuts their agent down', async () => {
    mocks.grants = [{ userId: 'macro|alice@x.test', accessLevel: 'edit' }];
    mocks.residents = [
      {
        bot_id: 'bot-1',
        name: 'Tod',
        owner_user_id: 'macro|alice@x.test',
        team_id: null,
      },
    ];
    mocks.confirm.mockResolvedValue(false);
    open(harness());
    expect(await screen.findByText('Resident')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(mocks.confirm.mock.calls[0]?.[0].title).toContain('Tod');
    expect(mocks.setGrant).not.toHaveBeenCalled();
  });

  it('warns before closing to a team whose agent lives there', async () => {
    mocks.residents = [
      { bot_id: 'bot-1', name: 'Tod', owner_user_id: null, team_id: 'team-1' },
    ];
    mocks.confirm.mockResolvedValue(true);
    open(harness({ shared_team_ids: ['team-1'] }));

    fireEvent.click(await screen.findByRole('switch', { name: 'Team access' }));

    await waitFor(() =>
      expect(mocks.setTeamAccess).toHaveBeenCalledWith({
        harnessId: harness().id,
        teamId: 'team-1',
        enabled: false,
      })
    );
    expect(mocks.confirm).toHaveBeenCalledOnce();
  });
});
