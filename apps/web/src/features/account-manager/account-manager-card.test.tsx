import { queryClient } from '@queries/client';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountManagerCard } from './account-manager-card';

const MANAGED = 'macro|person@example.com';
const MANAGER = 'macro|agent@example.com';
const GRANT_ID = '019a4f2e-7c1b-7d3a-9e2f-3b1c8d5a6f70';

const mocks = vi.hoisted(() => ({
  viewer: '',
  getGrant: vi.fn(),
  respond: vi.fn(),
  claim: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock('@core/context/user', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUserId: () => () => mocks.viewer,
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getAccountManagerGrant: mocks.getGrant,
    respondToAccountManagerRequest: mocks.respond,
    claimAccountManagerToken: mocks.claim,
    revokeAccountManagerGrant: mocks.revoke,
  },
}));

function grant(status: string, requestedBy: 'managed' | 'manager') {
  return {
    id: GRANT_ID,
    managedUserId: MANAGED,
    managerUserId: MANAGER,
    requestedBy,
    status,
    expiresAt: status === 'approved' ? '2026-11-11T00:00:00Z' : null,
    createdAt: '2026-11-04T00:00:00Z',
    claimedAt: null,
    lastUsedAt: null,
  };
}

async function showCard(viewer: string, shown: ReturnType<typeof grant>) {
  mocks.viewer = viewer;
  mocks.getGrant.mockResolvedValue(ok(shown));
  render(() => (
    <QueryClientProvider client={queryClient}>
      <AccountManagerCard grantId={GRANT_ID} />
    </QueryClientProvider>
  ));
  await waitFor(() => expect(mocks.getGrant).toHaveBeenCalled());
}

describe('AccountManagerCard', () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('approving takes a confirmation before anything is granted', async () => {
    await showCard(MANAGED, grant('pending', 'manager'));
    mocks.respond.mockResolvedValue(ok(grant('approved', 'manager')));

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(mocks.respond).not.toHaveBeenCalled();

    const buttons = await screen.findAllByRole('button', { name: 'Approve' });
    const confirm = buttons[buttons.length - 1];
    if (!confirm) throw new Error('expected the confirm button');
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(mocks.respond).toHaveBeenCalledWith({
        id: GRANT_ID,
        decision: 'approve',
      })
    );
  });

  it('the side that asked can withdraw but not approve', async () => {
    await showCard(MANAGED, grant('pending', 'managed'));

    await screen.findByRole('button', { name: 'Withdraw' });

    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('only the manager is offered the token', async () => {
    await showCard(MANAGED, grant('approved', 'manager'));

    await screen.findByText(/^Expires .* unless the token is revealed$/);

    expect(screen.queryByRole('button', { name: 'Reveal token' })).toBeNull();
  });

  it('reveals the token once to the manager', async () => {
    await showCard(MANAGER, grant('approved', 'manager'));
    mocks.claim.mockResolvedValue(
      ok({ grant: grant('active', 'manager'), token: 'mak_secret' })
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Reveal token' })
    );

    await screen.findByDisplayValue('mak_secret');
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Reveal token' })).toBeNull();
  });

  it.each(['declined', 'revoked', 'expired'])(
    'offers no actions once %s',
    async (status) => {
      await showCard(MANAGER, grant(status, 'manager'));

      await screen.findByText(/declined|ended|expired/);

      expect(screen.queryAllByRole('button')).toEqual([]);
    }
  );

  it('shows the unavailable label for a status it does not know', async () => {
    await showCard(MANAGER, grant('suspended', 'manager'));

    await screen.findByText('This request isn’t available');
  });

  it('says so when the viewer may not see the request', async () => {
    mocks.viewer = MANAGER;
    mocks.getGrant.mockResolvedValue(err([{ code: 'NOT_FOUND' }]));
    render(() => (
      <QueryClientProvider client={queryClient}>
        <AccountManagerCard grantId={GRANT_ID} />
      </QueryClientProvider>
    ));

    await screen.findByText('This request isn’t available');
  });
});
