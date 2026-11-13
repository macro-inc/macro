import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  createAgent: vi.fn(),
  startSignIn: vi.fn(),
  completeSignIn: vi.fn(),
  flag: () => ({ enabled: false, loading: false }),
  computersFlag: () => ({ enabled: false, loading: false }),
  harnesses: (): unknown[] => [],
  agents: (): unknown[] => [],
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () =>
    flag.key === 'enable-macro-computers'
      ? mocks.computersFlag()
      : mocks.flag(),
}));
vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessesQuery: () => ({
    get data() {
      return mocks.harnesses();
    },
  }),
}));
vi.mock('@queries/computers/claude', () => ({
  useClaudeSignInMutation: () => ({ mutateAsync: mocks.startSignIn }),
  useClaudeCompleteMutation: () => ({
    isPending: false,
    mutateAsync: mocks.completeSignIn,
  }),
}));
vi.mock('@queries/computers/computers', () => ({
  useComputerOffersQuery: () => ({
    isSuccess: true,
    isError: false,
    data: [
      {
        size: 'standard',
        vcpus: 4,
        memoryGb: 8,
        diskGb: 100,
        soldOut: false,
        notifyRequested: false,
        quote: {
          size: 'standard',
          amount: 4000,
          currency: 'usd',
          interval: 'month',
          priceId: 'price_standard',
        },
      },
      {
        size: 'large',
        vcpus: 8,
        memoryGb: 16,
        diskGb: 200,
        soldOut: false,
        notifyRequested: false,
        quote: {
          size: 'large',
          amount: 8000,
          currency: 'usd',
          interval: 'month',
          priceId: 'price_large',
        },
      },
    ],
  }),
  useNotifyComputerSizeMutation: () => ({ isPending: false }),
}));
vi.mock('@queries/agents/avatar', () => ({
  useUploadAgentAvatarMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@queries/team-agents/team-agents', () => ({
  useCreateTeamAgentMutation: () => ({
    isPending: false,
    mutateAsync: mocks.createAgent,
  }),
  useTeamAgentsQuery: () => ({
    get data() {
      return { agents: mocks.agents() };
    },
  }),
}));

vi.mock('@queries/team-agents/voices', () => ({
  useVoiceCatalogQuery: () => ({
    isSuccess: true,
    isLoading: false,
    isError: false,
    data: [
      {
        model: 'aura-2-arcas-en',
        name: 'Arcas',
        accent: 'American',
        tags: ['masculine', 'confident'],
        languages: ['en'],
      },
      {
        model: 'aura-2-thalia-en',
        name: 'Thalia',
        accent: 'American',
        tags: ['feminine', 'warm'],
        languages: ['en'],
      },
    ],
  }),
  fetchVoiceSample: vi.fn(),
}));

vi.mock('@queries/team/invites', () => ({
  useInviteToTeamMutation: () => ({
    isPending: false,
    mutate: mocks.mutate,
  }),
}));
vi.mock('./TeamInviteLinkSection', () => ({
  TeamInviteLinkSection: () => null,
  CopyTeamInviteLinkButton: () => (
    <button type="button">Copy invite link</button>
  ),
}));

import { InviteToTeamDialog } from './Team';

const [flag, setFlag] = createSignal({ enabled: false, loading: false });
const [computersFlag, setComputersFlag] = createSignal({
  enabled: false,
  loading: false,
});
const [harnesses, setHarnesses] = createSignal<unknown[]>([]);
const [agents, setAgents] = createSignal<unknown[]>([]);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  // The agent form's scrolling body measures itself.
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  setFlag({ enabled: false, loading: false });
  setComputersFlag({ enabled: false, loading: false });
  setHarnesses([]);
  setAgents([]);
  mocks.flag = flag;
  mocks.computersFlag = computersFlag;
  mocks.harnesses = harnesses;
  mocks.agents = agents;
});

afterEach(() => {
  cleanup();
  mocks.mutate.mockReset();
  mocks.createAgent.mockReset();
  mocks.startSignIn.mockReset();
  mocks.completeSignIn.mockReset();
});

function sendInvite(onClose: () => void = () => {}) {
  render(() => (
    <InviteToTeamDialog
      teamId="team-1"
      canManageLink={false}
      open
      onClose={onClose}
    />
  ));

  const email = screen.getByRole('textbox');
  fireEvent.input(email, { target: { value: 'invitee@signup.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
}

describe('InviteToTeamDialog', () => {
  it('invites people, not agents', () => {
    sendInvite();

    expect(mocks.mutate.mock.calls[0]?.[0]).toEqual({
      teamId: 'team-1',
      request: { invites: [{ email: 'invitee@signup.test' }], is_agent: false },
    });
  });

  it('asks the inviter to give a heads-up with the invite link after sending', () => {
    const onClose = vi.fn();
    sendInvite(onClose);
    mocks.mutate.mock.calls[0]?.[1]?.onSuccess?.();

    expect(screen.getByText("Let them know it's coming")).toBeTruthy();
    expect(screen.getByText('invitee@signup.test')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Copy invite link' })
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays on the invite form when a send finishes after the dialog closed', () => {
    sendInvite();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    mocks.mutate.mock.calls[0]?.[1]?.onSuccess?.();

    expect(screen.queryByText("Let them know it's coming")).toBeNull();
  });
});

describe('InviteToTeamDialog agent teammates', () => {
  function openAsAdmin(onClose: () => void = () => {}) {
    render(() => (
      <InviteToTeamDialog
        teamId="team-1"
        canManageLink
        canInviteAgents
        open
        onClose={onClose}
      />
    ));
  }

  it('offers only people while the flag is off or loading', () => {
    setFlag({ enabled: false, loading: true });
    openAsAdmin();
    expect(screen.queryByRole('radio', { name: 'Agent' })).toBeNull();

    setFlag({ enabled: false, loading: false });
    expect(screen.queryByRole('radio', { name: 'Agent' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeTruthy();
  });

  it('offers only people to members who cannot manage the team', () => {
    setFlag({ enabled: true, loading: false });
    render(() => (
      <InviteToTeamDialog
        teamId="team-1"
        canManageLink={false}
        open
        onClose={() => {}}
      />
    ));
    expect(screen.queryByRole('radio', { name: 'Agent' })).toBeNull();
  });

  it('invites an agent on the chosen computer and suggested voice, priced like a computer', async () => {
    setFlag({ enabled: true, loading: false });
    const onClose = vi.fn();
    mocks.createAgent.mockResolvedValue({ name: 'Ada' });
    openAsAdmin(onClose);

    fireEvent.click(screen.getByRole('radio', { name: 'Agent' }));
    const invite = () =>
      screen.getByRole('button', {
        name: /^Invite agent/,
      }) as HTMLButtonElement;
    expect(invite().disabled).toBe(true);

    fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: ' Ada ' },
    });
    fireEvent.input(screen.getByRole('textbox', { name: 'Job description' }), {
      target: { value: 'Triage support email.' },
    });
    fireEvent.input(screen.getByRole('textbox', { name: 'Personality' }), {
      target: { value: 'Warm and concise.' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Large' }));
    // The personality's own words pick the suggested voice.
    expect(
      (screen.getByRole('combobox', { name: 'Voice' }) as HTMLInputElement)
        .value
    ).toBe('Thalia');

    expect(invite().textContent).toContain('$80');
    // A failed invite keeps its purchase key, so retrying buys one computer.
    mocks.createAgent.mockRejectedValueOnce(new Error('network'));
    fireEvent.click(invite());
    await vi.waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        "Couldn't invite the agent"
      )
    );
    fireEvent.click(invite());

    const [first, retry] = mocks.createAgent.mock.calls.map((call) => call[0]);
    expect(first).toEqual({
      teamId: 'team-1',
      request: {
        name: 'Ada',
        jobDescription: 'Triage support email.',
        personality: 'Warm and concise.',
        size: 'large',
        avatarUrl: null,
        purchaseKey: expect.any(String),
        voice: 'aura-2-thalia-en',
      },
    });
    expect(retry).toEqual(first);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('falls back to people when the flag turns off mid-invite', () => {
    setFlag({ enabled: true, loading: false });
    openAsAdmin();
    fireEvent.click(screen.getByRole('radio', { name: 'Agent' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();

    setFlag({ enabled: false, loading: false });
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeTruthy();
  });

  describe('Bring your AI after the purchase', () => {
    const ada = {
      userId: 'macro|ada@agents.macro.invalid',
      teamId: 'team-1',
      name: 'Ada',
      jobDescription: 'Triage support email.',
      personality: 'Warm and concise.',
      createdBy: 'macro|maya@example.com',
      computerId: null,
      status: 'provisioning',
      createdAt: '2026-11-11T09:00:00Z',
    };
    const adaHarness = {
      id: 'harness-ada',
      computer_id: 'computer-ada',
      access: 'owner',
      connected: true,
    };

    async function inviteAda(onClose: () => void) {
      setFlag({ enabled: true, loading: false });
      setComputersFlag({ enabled: true, loading: false });
      mocks.createAgent.mockResolvedValue(ada);
      openAsAdmin(onClose);
      fireEvent.click(screen.getByRole('radio', { name: 'Agent' }));
      fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), {
        target: { value: 'Ada' },
      });
      fireEvent.input(
        screen.getByRole('textbox', { name: 'Job description' }),
        { target: { value: 'Triage support email.' } }
      );
      fireEvent.input(screen.getByRole('textbox', { name: 'Personality' }), {
        target: { value: 'Warm and concise.' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^Invite agent/ }));
      await vi.waitFor(() =>
        expect(screen.getByText('Bring your AI to Ada')).toBeTruthy()
      );
    }

    it("waits for the agent's computer, then signs it in to Claude", async () => {
      const onClose = vi.fn();
      mocks.startSignIn.mockResolvedValue({
        url: 'https://claude.com/cai/oauth/authorize?state=abc',
      });
      mocks.completeSignIn.mockResolvedValue({ signedIn: true });
      await inviteAda(onClose);

      // Bought but not enrolled yet: nothing to sign in on.
      expect(screen.getByRole('status').textContent).toContain(
        'Preparing sign-in'
      );
      expect(mocks.startSignIn).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      setAgents([{ ...ada, computerId: 'computer-ada' }]);
      setHarnesses([{ ...adaHarness, connected: false }]);
      expect(mocks.startSignIn).not.toHaveBeenCalled();

      setHarnesses([adaHarness]);
      await vi.waitFor(() =>
        expect(
          screen.getByRole('link', { name: /Open claude.ai/ })
        ).toBeTruthy()
      );
      expect(mocks.startSignIn.mock.calls[0]?.[0]).toMatchObject({
        harnessId: 'harness-ada',
        entry: 'team_agent_invite',
      });

      fireEvent.click(screen.getByRole('link', { name: /Open claude.ai/ }));
      fireEvent.input(
        screen.getByRole('textbox', {
          name: 'Paste the code Claude showed you',
        }),
        { target: { value: ' code-123 ' } }
      );
      fireEvent.click(screen.getByRole('button', { name: 'Complete sign-in' }));
      await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(mocks.completeSignIn.mock.calls[0]?.[0]).toMatchObject({
        harnessId: 'harness-ada',
        entry: 'team_agent_invite',
        code: 'code-123',
      });
    });

    it('lets the inviter skip and keep Macro credits while the computer starts', async () => {
      const onClose = vi.fn();
      await inviteAda(onClose);

      fireEvent.click(
        screen.getByRole('button', { name: 'Skip, use Macro credits' })
      );
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(mocks.startSignIn).not.toHaveBeenCalled();
    });
  });
});
