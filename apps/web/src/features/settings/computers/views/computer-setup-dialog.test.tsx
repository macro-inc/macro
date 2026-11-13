/**
 * @vitest-environment jsdom
 */

import { agentSettingsRequest } from '@app/features/settings/agentSettingsState';
import type { ComputerStatus } from '@service-auth/computers';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { ActionDialogShell, Dialog } from '@ui';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ComputerSetupSteps,
  claudeStepMark,
  StepHeader,
} from './computer-setup-dialog';

const mocks = vi.hoisted(() => ({
  agents: [] as { bot: { id: string; name: string } }[],
  openAgentsPage: vi.fn(),
  openSettings: vi.fn(),
  closeSettings: vi.fn(),
  invalidateAgents: vi.fn(async () => {}),
  mobile: false,
}));

vi.mock('@app/features/agents-view/primitives/open-page', () => ({
  openAgentsPage: mocks.openAgentsPage,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({}),
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
  useClaudeSignOutMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@queries/computers/computers', () => ({
  useCompleteComputerSetupMutation: () => ({ mutateAsync: vi.fn() }),
  useRetryComputerMutation: () => ({ mutateAsync: vi.fn() }),
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
  options: { selectsForAgent?: boolean; computer?: ComputerStatus } = {}
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
          choice="own_account"
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
  vi.clearAllMocks();
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

it('opens the composer in Code with the configured agent selected', () => {
  const onClose = readyStep();

  fireEvent.click(screen.getByRole('button', { name: 'Try it' }));

  expect(onClose).toHaveBeenCalledOnce();
  expect(mocks.openAgentsPage).toHaveBeenCalledWith(expect.anything(), 'new', {
    composerAgentId: 'computer-agent',
  });
});

it('opens the create form with this computer chosen as where it runs', () => {
  const onClose = readyStep();

  fireEvent.click(
    screen.getByRole('button', { name: 'Create an agent on this computer' })
  );

  expect(onClose).toHaveBeenCalledOnce();
  expect(mocks.openSettings).toHaveBeenCalledWith('Agents');
  expect(agentSettingsRequest()).toMatchObject({
    type: 'create',
    harnessId: 'computer-harness',
  });
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

it('keeps both actions disabled, with the reason, until setup finishes', () => {
  readyStep({ computer: { ...ready, setupCompletedAt: undefined } });

  expect(
    screen.getByRole('button', { name: 'Try it' }).hasAttribute('disabled')
  ).toBe(true);
  expect(
    screen
      .getByRole('button', { name: 'Create an agent on this computer' })
      .hasAttribute('disabled')
  ).toBe(true);
  expect(
    screen.getByText('Try it and creating agents unlock once setup finishes.')
  ).toBeTruthy();
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
    screen.getByText(/Everyone using this computer can use this Claude sign-in/)
  ).toBeTruthy();
  waiting.unmount();

  setup({ ...settingUp, status: 'failed' });
  expect(
    screen.queryByText(
      /Everyone using this computer can use this Claude sign-in/
    )
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Use Macro credits instead' })
  ).toBeNull();
});
