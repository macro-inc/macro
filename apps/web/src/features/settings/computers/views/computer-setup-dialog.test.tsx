/**
 * @vitest-environment jsdom
 */

import type { ComputerStatus } from '@service-auth/computers';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { ActionDialogShell, Dialog } from '@ui';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ComputerSetupSteps,
  claudeStepMark,
  StepHeader,
} from './computer-setup-dialog';

const mocks = vi.hoisted(() => ({
  agents: [] as { bot: { id: string; name: string } }[],
  openAgentDm: vi.fn(async (_botId: string) => {}),
  agentDms: true,
  signOut: vi.fn(async (_harnessId: string) => {}),
  completeSetup: vi.fn(async (_computerId: string) => {}),
  openSettings: vi.fn(),
  closeSettings: vi.fn(),
  invalidateAgents: vi.fn(async () => {}),
  retry: vi.fn(async () => {}),
  mobile: false,
}));

vi.mock('@app/features/agent-dms/open-agent-dm', () => ({
  useOpenAgentDm: () => ({ open: mocks.openAgentDm, pending: () => false }),
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get ENABLE_AGENT_DMS() {
    return mocks.agentDms;
  },
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({
    openSettings: mocks.openSettings,
    closeSettings: mocks.closeSettings,
  }),
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mocks.mobile }));
vi.mock('@queries/agents/agents', () => ({
  useAgentsQuery: () => ({ isSuccess: true, data: mocks.agents }),
  invalidateAgents: mocks.invalidateAgents,
}));
vi.mock('@queries/bots/bots', () => ({
  useUpdateBotMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@queries/computers/claude', () => ({
  useClaudeSignOutMutation: () => ({ mutateAsync: mocks.signOut }),
}));
vi.mock('@queries/computers/computers', () => ({
  useCompleteComputerSetupMutation: () => ({
    mutateAsync: mocks.completeSetup,
  }),
  useRetryComputerMutation: () => ({
    mutateAsync: mocks.retry,
    isPending: false,
  }),
}));
vi.mock('@queries/harnesses/harnesses', () => ({
  invalidateHarnesses: vi.fn(async () => {}),
}));
vi.mock('./claude-sign-in-flow', () => ({ ClaudeSignInFlow: () => null }));

const ready: ComputerStatus = {
  id: 'computer-1',
  name: "Maya's Agent Box",
  size: 'standard',
  vcpus: 4,
  memoryGib: 8,
  diskGib: 100,
  catalogEntry: 'standard@2026-11',
  status: 'ready',
  billing: 'active',
  poweredOn: true,
  agentCount: 1,
  canUndoCancel: false,
  canRestore: false,
  purchasedBy: 'viewer',
  createdAt: '2026-11-01T00:00:00Z',
  harnessId: 'computer-harness',
  defaultAgentId: 'computer-agent',
  setupCompletedAt: '2026-11-01T00:05:00Z',
};

function readyStep(
  options: {
    selectsForAgent?: boolean;
    computer?: ComputerStatus;
    choice?: 'own_account' | 'macro_credits';
  } = {}
) {
  const onClose = vi.fn();
  render(() => (
    <Dialog open onOpenChange={() => {}}>
      <ActionDialogShell>
        <ComputerSetupSteps
          computer={options.computer ?? ready}
          connected
          firstName="Maya"
          step="ready"
          name={undefined}
          choice={options.choice ?? 'own_account'}
          onName={vi.fn()}
          onChoice={vi.fn()}
          onStep={vi.fn()}
          onClose={onClose}
          selectsForAgent={options.selectsForAgent}
        />
      </ActionDialogShell>
    </Dialog>
  ));
  return onClose;
}

beforeEach(() => {
  mocks.agents = [{ bot: { id: 'computer-agent', name: "Maya's Agent" } }];
  mocks.mobile = false;
  mocks.agentDms = true;
  vi.clearAllMocks();
  mocks.signOut.mockImplementation(async () => {});
  mocks.completeSetup.mockImplementation(async () => {});
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('names the four setup steps in order and marks the current one', () => {
  render(() => <StepHeader step="agent" claude="step" />);

  const steps = screen.getByRole('list', { name: 'Setup steps' });
  const items = steps.querySelectorAll('li');
  expect([...items].map((item) => item.textContent)).toEqual([
    'Buy computer',
    'Configure agent',
    'Bring your AI',
    'Create agent',
  ]);
  expect(items[1].getAttribute('aria-current')).toBe('step');
  expect(items[0].getAttribute('aria-current')).toBeNull();
});

it('keeps the phone step bar to short labels', () => {
  mocks.mobile = true;
  render(() => <StepHeader step="ready" claude="step" />);

  const items = screen
    .getByRole('list', { name: 'Setup steps' })
    .querySelectorAll('li');
  expect([...items].map((item) => item.textContent)).toEqual([
    'Buy',
    'Agent',
    'Your AI',
    'Create',
  ]);
});

it('marks Bring your AI skipped, not struck, when the agent runs on Macro credits', () => {
  render(() => <StepHeader step="ready" claude="skipped" />);

  const items = screen
    .getByRole('list', { name: 'Setup steps' })
    .querySelectorAll('li');
  expect(items[2].textContent).toBe('Bring your AI · skipped');
  expect(items[2].className).toContain('text-ink-extra-muted');
  expect(items[2].className).not.toContain('line-through');
  expect(items[1].textContent).toBe('Configure agent');
});

it('marks Bring your AI done on Macro credits once its sign-in was opened', () => {
  expect(claudeStepMark(undefined, false)).toBe('step');
  expect(claudeStepMark('own_account', true)).toBe('step');
  expect(claudeStepMark('macro_credits', false)).toBe('skipped');
  expect(claudeStepMark('macro_credits', true)).toBe('credits');

  render(() => <StepHeader step="ready" claude="credits" />);
  const items = screen
    .getByRole('list', { name: 'Setup steps' })
    .querySelectorAll('li');
  expect(items[2].textContent).toBe('Bring your AI · Macro credits');
  expect(items[2].className).toContain('text-ink-muted');
  expect(items[2].querySelector('svg')).toBeTruthy();
});

it('opens a chat with the agent it just set up, as the one action', () => {
  const onClose = readyStep();

  expect(screen.getByText("Maya's Agent is ready")).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: "Chat with Maya's Agent" })
  );

  expect(onClose).toHaveBeenCalledOnce();
  expect(mocks.openAgentDm).toHaveBeenCalledWith('computer-agent');
  expect(
    screen.queryByRole('button', { name: 'Add another agent' })
  ).toBeNull();
});

it('ends on Done when agent chats are off, with nothing else to open', () => {
  mocks.agentDms = false;
  const onClose = readyStep();

  expect(screen.queryByRole('button', { name: /Chat with/ })).toBeNull();
  const done = screen.getAllByRole('button', { name: 'Done' });
  expect(done).toHaveLength(1);
  fireEvent.click(done[0]);
  expect(onClose).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole('button', { name: 'Add another agent' })
  ).toBeNull();
});

it('only closes from an agent editor, whose Where it runs takes the computer', () => {
  const onClose = readyStep({ selectsForAgent: true });

  fireEvent.click(screen.getByRole('button', { name: 'Use for this agent' }));

  expect(onClose).toHaveBeenCalledOnce();
  expect(mocks.openSettings).not.toHaveBeenCalled();
});

it('refetches a cached agent list that predates the computer agent', () => {
  mocks.agents = [];
  readyStep();

  expect(mocks.invalidateAgents).toHaveBeenCalledOnce();
});

it('waits on the button while setup finishes, with no other action', () => {
  readyStep({ computer: { ...ready, setupCompletedAt: undefined } });

  expect(screen.getByText("Setting up Maya's Agent")).toBeTruthy();
  const waiting = screen.getByRole('button', {
    name: 'Setting up…',
  });
  expect(waiting.hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('button', { name: /Chat with/ })).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Add another agent' })
  ).toBeNull();
  expect(screen.queryByText(/You can close this/)).toBeNull();
});

it('stops on one error with Retry when a finishing step fails', async () => {
  mocks.signOut.mockRejectedValueOnce(new Error('exec deadlock'));
  readyStep({
    computer: { ...ready, setupCompletedAt: undefined },
    choice: 'macro_credits',
  });

  await screen.findByText("Couldn't finish setting up Maya's Agent");
  expect(mocks.completeSetup).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(
    () => expect(mocks.completeSetup).toHaveBeenCalledWith('computer-1'),
    { timeout: 5000 }
  );
  expect(mocks.signOut).toHaveBeenCalledTimes(2);
});

it('stops on the same error when a finishing step never answers', async () => {
  vi.useFakeTimers();
  try {
    mocks.signOut.mockImplementationOnce(() => new Promise(() => {}));
    readyStep({
      computer: { ...ready, setupCompletedAt: undefined },
      choice: 'macro_credits',
    });

    await vi.advanceTimersByTimeAsync(20_000);
    expect(
      screen.getByText("Couldn't finish setting up Maya's Agent")
    ).toBeTruthy();
    expect(mocks.completeSetup).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('drops the shared sign-in note from Bring your AI once setup has failed', () => {
  const setup = (computer: ComputerStatus) =>
    render(() => (
      <Dialog open onOpenChange={() => {}}>
        <ActionDialogShell>
          <ComputerSetupSteps
            computer={computer}
            connected={false}
            firstName="Maya"
            step="claude"
            name={undefined}
            choice="own_account"
            onName={vi.fn()}
            onChoice={vi.fn()}
            onStep={vi.fn()}
            onClose={vi.fn()}
          />
        </ActionDialogShell>
      </Dialog>
    ));
  const settingUp: ComputerStatus = {
    ...ready,
    status: 'setting_up',
    setup: { step: 'booting', position: 2, total: 4 },
    setupCompletedAt: null,
  };

  const waiting = setup(settingUp);
  expect(
    screen.getByText(/Everyone using this computer can use this sign-in/)
  ).toBeTruthy();
  waiting.unmount();

  setup({ ...settingUp, status: 'failed' });
  expect(
    screen.queryByText(/Everyone using this computer can use this sign-in/)
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Use Macro credits instead' })
  ).toBeNull();
});

function agentStep(
  computer: ComputerStatus,
  options: { choice?: 'own_account' | 'macro_credits' } = {}
) {
  const onChoice = vi.fn();
  render(() => (
    <Dialog open onOpenChange={() => {}}>
      <ActionDialogShell>
        <ComputerSetupSteps
          computer={computer}
          connected={false}
          firstName="Maya"
          step="agent"
          name={undefined}
          choice={options.choice}
          onName={vi.fn()}
          onChoice={onChoice}
          onStep={vi.fn()}
          onClose={vi.fn()}
        />
      </ActionDialogShell>
    </Dialog>
  ));
  return onChoice;
}

const booting: ComputerStatus = {
  ...ready,
  status: 'setting_up',
  setup: { step: 'booting', position: 2, total: 4 },
  setupCompletedAt: null,
};

it('shows setup as one line under the steps, expanding to every stage', () => {
  agentStep(booting);

  const line = screen.getByRole('button', { name: /^Starting up · \d+:\d\d$/ });
  expect(line.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('list', { name: 'Setup progress' })).toBeNull();

  fireEvent.click(line);

  expect(line.getAttribute('aria-expanded')).toBe('true');
  const stages = screen
    .getByRole('list', { name: 'Setup progress' })
    .querySelectorAll('li');
  expect([...stages].map((stage) => stage.textContent)).toEqual([
    'Billing updated',
    'Computer created',
    expect.stringMatching(/^Starting up\d+:\d\d$/),
    'Connecting to Macro',
    'Sign in to Claude',
  ]);
});

it('asks for Claude with two one-line options, and no hint under Continue', () => {
  const onChoice = agentStep(booting);

  expect(
    screen.queryByText('Agents on this computer run Claude Code.')
  ).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')
  ).toBe(true);
  expect(screen.queryByText(/to continue\.$/)).toBeNull();
  const choice = screen.getByRole('radiogroup', {
    name: 'Which Claude should it use?',
  });
  const options = choice.querySelectorAll('input[type="radio"]');
  expect(options).toHaveLength(2);
  fireEvent.click(screen.getByRole('radio', { name: 'Macro credits' }));
  expect(onChoice).toHaveBeenCalledWith('macro_credits');
});

it('replaces the progress line with one banner when setup fails', () => {
  const failed = {
    ...booting,
    status: 'failed' as const,
    setup: { step: 'creating' as const, position: 1, total: 4 },
  };
  Reflect.set(failed, 'failureReason', 'The host ran out of disk.');
  agentStep(failed);

  expect(screen.getByRole('alert').textContent).toBe(
    "Couldn't create the computer: the host ran out of disk"
  );
  expect(
    screen.queryByRole('button', { name: /Creating the computer/ })
  ).toBeNull();
  expect(screen.queryByRole('list', { name: 'Setup progress' })).toBeNull();
  expect(screen.queryByText(/no extra charge/)).toBeNull();

  const details = screen.getByRole('button', { name: 'Details' });
  fireEvent.click(details);
  expect(details.getAttribute('aria-expanded')).toBe('true');
  expect(
    screen.getByText(
      'Retry sets it up again at no extra charge. Contact support if it fails again.'
    )
  ).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Retry setup' }));
  expect(mocks.retry).toHaveBeenCalledWith('computer-1');
  // The agent form stays usable below the banner.
  expect(screen.getByLabelText('Agent name')).toBeTruthy();
});

it('offers no Retry to a computer waiting on support', () => {
  agentStep({ ...booting, status: 'needs_attention' });

  expect(screen.getByRole('alert').textContent).toBe(
    'Needs attention — contact support'
  );
  expect(screen.queryByRole('button', { name: 'Retry setup' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Details' })).toBeNull();
});
