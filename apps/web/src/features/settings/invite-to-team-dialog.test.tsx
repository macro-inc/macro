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
  toastSuccess: vi.fn(),
  fetchAgents: vi.fn(),
  retryComputer: vi.fn(),
  openDm: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.toastSuccess, failure: vi.fn() },
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  // Agents on the inviter's own machines are their own feature, off here.
  useFeatureFlag: (flag: { key?: string }) => () =>
    flag?.key === 'enable-self-hosted-teammates'
      ? { loading: false, enabled: false }
      : mocks.flag(),
}));
vi.mock('@queries/team-agents/hosts', () => ({
  useTeammateHostsQuery: () => ({ isSuccess: false, isError: false }),
  useRecheckTeammateHostMutation: () => ({ mutate: () => {} }),
}));
vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessesQuery: () => ({
    isSuccess: true,
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
  useMacroComputersRollout: () => () => mocks.computersFlag(),
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
vi.mock('@queries/team-agents/team-agents', () => ({
  useCreateTeamAgentMutation: () => ({
    isPending: false,
    mutateAsync: mocks.createAgent,
  }),
  fetchTeamAgents: mocks.fetchAgents,
  useTeamAgentsQuery: () => ({
    isSuccess: true,
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
vi.mock('./primitives/team-agent-status', () => ({
  retryTeamAgentComputer: mocks.retryComputer,
}));
vi.mock('../notifications/computer-setup-toast', () => ({
  openAgentDirectMessage: mocks.openDm,
  openBilling: vi.fn(),
}));
vi.mock('./TeamInviteLinkSection', () => ({
  TeamInviteLinkSection: () => null,
  CopyTeamInviteLinkButton: () => (
    <button type="button">Copy invite link</button>
  ),
}));

import { ThrownResultError } from '@core/util/result';
import { InviteToTeamDialog, useCanInviteAgents } from './Team';

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
  // An invite error scrolls itself into view; jsdom has no layout.
  Element.prototype.scrollIntoView = vi.fn();
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
  mocks.toastSuccess.mockReset();
  mocks.fetchAgents.mockReset();
  mocks.retryComputer.mockReset();
  mocks.openDm.mockReset();
  vi.useRealTimers();
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

/** Invite Agent's dialog, gated the way Members gates it. */
function AgentInviteDialog(props: { admin: boolean; onClose: () => void }) {
  const canInviteAgents = useCanInviteAgents(() => props.admin);
  return (
    <InviteToTeamDialog
      teamId="team-1"
      canManageLink={props.admin}
      kind="agent"
      canInviteAgents={canInviteAgents()}
      open
      onClose={props.onClose}
    />
  );
}

const agentForm = () => screen.queryByRole('textbox', { name: 'Name it' });

describe('InviteToTeamDialog agent teammates', () => {
  function openAsAdmin(onClose: () => void = () => {}) {
    render(() => <AgentInviteDialog admin onClose={onClose} />);
  }

  it('offers only people while computers are off, even with agent teammates on', () => {
    setFlag({ enabled: true, loading: false });
    setComputersFlag({ enabled: false, loading: false });
    openAsAdmin();
    expect(agentForm()).toBeNull();
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeTruthy();

    setComputersFlag({ enabled: true, loading: false });
    expect(agentForm()).toBeTruthy();
  });

  it('offers only people while the flag is off or loading', () => {
    setFlag({ enabled: false, loading: true });
    openAsAdmin();
    expect(agentForm()).toBeNull();

    setFlag({ enabled: false, loading: false });
    expect(agentForm()).toBeNull();
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeTruthy();
  });

  it('offers only people to members who cannot manage the team', () => {
    setFlag({ enabled: true, loading: false });
    setComputersFlag({ enabled: true, loading: false });
    render(() => <AgentInviteDialog admin={false} onClose={() => {}} />);
    expect(agentForm()).toBeNull();
  });

  const ada = {
    userId: 'macro|ada@agents.test',
    name: 'Ada',
    teamId: 'team-1',
    computerId: 'computer-1',
    status: 'provisioning',
  };
  const refusal = (code: string) =>
    new ThrownResultError([{ code, message: code }]);

  function startAdding(name = 'Ada') {
    fireEvent.input(screen.getByRole('textbox', { name: 'Name it' }), {
      target: { value: name },
    });
  }
  const addButton = () =>
    screen.getByRole('button', {
      name: /^(Add|Try again|Retry)/,
    }) as HTMLButtonElement;

  it('adds an agent by name and size, waits until it is online, and lands in its DM', async () => {
    setFlag({ enabled: true, loading: false });
    setComputersFlag({ enabled: true, loading: false });
    const onClose = vi.fn();
    mocks.createAgent.mockResolvedValue(ada);
    mocks.fetchAgents
      .mockResolvedValueOnce({ agents: [{ ...ada, status: 'starting' }] })
      .mockResolvedValue({ agents: [{ ...ada, status: 'running' }] });
    openAsAdmin(onClose);

    // Add stays pressable: with no name it marks the field and sends nothing.
    const field = screen.getByRole('textbox', {
      name: 'Name it',
    });
    fireEvent.click(addButton());
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);
    expect(mocks.createAgent).not.toHaveBeenCalled();
    fireEvent.input(field, { target: { value: 'Ada' } });
    expect(field.getAttribute('aria-invalid')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Large' }));
    expect(addButton().textContent).toContain('Add Ada');
    expect(addButton().textContent).toContain('$80');

    fireEvent.click(addButton());
    expect(screen.getByRole('button', { name: /Adding Ada/ })).toBeTruthy();

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.openDm).toHaveBeenCalledWith(ada.userId);
    expect(mocks.createAgent.mock.calls[0][0]).toMatchObject({
      teamId: 'team-1',
      request: {
        name: 'Ada',
        jobDescription: '',
        personality: '',
        size: 'large',
        avatarUrl: null,
        purchaseKey: expect.any(String),
      },
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('closes into the DM with the agent still starting after five seconds', async () => {
    vi.useFakeTimers();
    setFlag({ enabled: true, loading: false });
    setComputersFlag({ enabled: true, loading: false });
    const onClose = vi.fn();
    mocks.createAgent.mockResolvedValue(ada);
    mocks.fetchAgents.mockResolvedValue({ agents: [ada] });
    openAsAdmin(onClose);
    startAdding();
    fireEvent.click(addButton());

    await vi.advanceTimersByTimeAsync(4_000);
    expect(onClose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.openDm).toHaveBeenCalledWith(ada.userId);
  });

  it('keeps the dialog on a declined card, and tries again with a new purchase', async () => {
    setFlag({ enabled: true, loading: false });
    setComputersFlag({ enabled: true, loading: false });
    mocks.createAgent.mockRejectedValueOnce(refusal('PAYMENT_DECLINED'));
    openAsAdmin();
    startAdding();
    fireEvent.click(addButton());

    await vi.waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Nothing was charged'
      )
    );
    expect(screen.getByRole('button', { name: 'Update card' })).toBeTruthy();
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Name it',
        }) as HTMLInputElement
      ).value
    ).toBe('Ada');

    mocks.createAgent.mockResolvedValue(ada);
    mocks.fetchAgents.mockResolvedValue({
      agents: [{ ...ada, status: 'running' }],
    });
    expect(addButton().textContent).toContain('Try again');
    fireEvent.click(addButton());
    await vi.waitFor(() => expect(mocks.openDm).toHaveBeenCalled());
    const [declined, again] = mocks.createAgent.mock.calls.map(
      (call) => call[0].request.purchaseKey
    );
    expect(again).not.toBe(declined);
  });

  it('marks a size with no room and lets another size be picked', async () => {
    setFlag({ enabled: true, loading: false });
    setComputersFlag({ enabled: true, loading: false });
    mocks.createAgent.mockRejectedValueOnce(refusal('NO_ROOM'));
    openAsAdmin();
    startAdding();
    fireEvent.click(addButton());

    await vi.waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'No room for a Standard computer'
      )
    );
    expect(
      (screen.getByRole('radio', { name: /Standard/ }) as HTMLInputElement)
        .disabled
    ).toBe(true);
    // The next size on sale is picked.
    expect(addButton().textContent).toContain('$80');
  });

  it('retries a computer that did not start on the same computer, then shows the refund', async () => {
    setFlag({ enabled: true, loading: false });
    setComputersFlag({ enabled: true, loading: false });
    mocks.createAgent.mockResolvedValue(ada);
    mocks.fetchAgents.mockResolvedValue({
      agents: [{ ...ada, status: 'failed' }],
    });
    mocks.retryComputer.mockResolvedValue(undefined);
    openAsAdmin();
    startAdding();
    fireEvent.click(addButton());

    await vi.waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        "Ada didn't start on its computer"
      )
    );
    fireEvent.click(addButton());
    await vi.waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'The charge was undone'
      )
    );
    expect(mocks.retryComputer).toHaveBeenCalledWith('computer-1');
    expect(mocks.createAgent).toHaveBeenCalledTimes(1);
  });

  it('falls back to people when the flag turns off mid-invite', () => {
    setFlag({ enabled: true, loading: false });
    setComputersFlag({ enabled: true, loading: false });
    openAsAdmin();
    expect(screen.getByRole('textbox', { name: 'Name it' })).toBeTruthy();

    setFlag({ enabled: false, loading: false });
    expect(screen.queryByRole('textbox', { name: 'Name it' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeTruthy();
  });
});
