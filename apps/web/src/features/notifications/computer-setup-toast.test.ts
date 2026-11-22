import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openWithSplit: vi.fn(),
  getOrCreate: vi.fn(),
  toastFailure: vi.fn(),
  // The signed-in account and its session, as account-scope reports it.
  account: { userId: 'macro|maya@example.com', session: 1 } as
    | { userId: string; session: number }
    | undefined,
}));

// The notice code this module also holds is not under test here.
vi.mock('@app/features/settings/computers/primitives/setup-notice', () => ({
  showComputerSetupNotice: vi.fn(),
}));
vi.mock('@app/features/settings/computers/primitives/setup-request', () => ({
  requestComputerSetup: vi.fn(),
}));
vi.mock('@app/features/settings/primitives/team-agent-claude-request', () => ({
  requestAgentClaude: vi.fn(),
}));
vi.mock('@app/features/settings/primitives/team-agent-setup-notice', () => ({
  showTeamAgentSetupNotice: vi.fn(),
}));
vi.mock('@app/features/settings/primitives/team-agent-status', () => ({
  retryTeamAgentComputer: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.toastFailure },
}));
vi.mock('@queries/harnesses/harnesses', () => ({ fetchHarnesses: vi.fn() }));
vi.mock('./notification-navigation', () => ({
  openBillingSettings: vi.fn(),
  openRuntimesSettings: vi.fn(),
  openTeamMembersSettings: vi.fn(),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@queries/auth/account-scope', () => ({
  currentQueryAccount: () => mocks.account,
  isCurrentQueryAccount: (account?: { userId: string; session: number }) =>
    !!account &&
    account.userId === mocks.account?.userId &&
    account.session === mocks.account?.session,
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getOrCreateDirectMessage: mocks.getOrCreate },
}));
vi.mock('@queries/channel/channels', () => ({
  invalidateListChannels: () => Promise.resolve(),
}));

import { err, ok } from 'neverthrow';
import { openAgentDirectMessage } from './computer-setup-toast';

beforeEach(() => {
  mocks.account = { userId: 'macro|maya@example.com', session: 1 };
  mocks.openWithSplit.mockReset();
  mocks.getOrCreate.mockReset();
  mocks.toastFailure.mockReset();
});

describe('openAgentDirectMessage', () => {
  it('opens the real DM with a new agent, so its greeting lands in the open conversation', async () => {
    mocks.getOrCreate.mockResolvedValue(ok({ channel_id: 'channel-ada' }));

    await openAgentDirectMessage('macro|ada@agents.macro.invalid');

    await vi.waitFor(() =>
      expect(mocks.openWithSplit).toHaveBeenCalledWith(
        { type: 'channel', id: 'channel-ada' },
        { activate: true, referredFrom: null }
      )
    );
    expect(mocks.getOrCreate).toHaveBeenCalledWith({
      recipient_id: 'macro|ada@agents.macro.invalid',
    });
  });

  it('says so when the DM cannot be opened, and opens nothing', async () => {
    mocks.getOrCreate.mockResolvedValue(
      err([{ name: 'ResultError', code: 'HTTP_500', message: 'boom' }])
    );

    await openAgentDirectMessage('macro|ada@agents.macro.invalid');

    await vi.waitFor(() =>
      expect(mocks.toastFailure).toHaveBeenCalledWith(
        "Couldn't open the conversation. Try again."
      )
    );
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
  });

  it('opens nothing from a notice shown to an account that has since signed out of this tab', async () => {
    mocks.getOrCreate.mockResolvedValue(ok({ channel_id: 'channel-ada' }));
    const shownTo = { userId: 'macro|maya@example.com', session: 1 };
    // Another account signs in before the notice's Message is pressed.
    mocks.account = { userId: 'macro|sam@example.com', session: 2 };

    await openAgentDirectMessage('macro|ada@agents.macro.invalid', shownTo);

    expect(mocks.getOrCreate).not.toHaveBeenCalled();
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
  });

  it('opens nothing when the account changes while the DM is being made', async () => {
    let answer: (value: unknown) => void = () => {};
    mocks.getOrCreate.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );

    const opening = openAgentDirectMessage('macro|ada@agents.macro.invalid');
    await vi.waitFor(() => expect(mocks.getOrCreate).toHaveBeenCalled());
    mocks.account = { userId: 'macro|sam@example.com', session: 2 };
    answer(ok({ channel_id: 'channel-ada' }));
    await opening;

    expect(mocks.openWithSplit).not.toHaveBeenCalled();
  });
});
