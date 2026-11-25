import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  showComputer: vi.fn(),
  showTeamAgentFailure: vi.fn(),
  retry: vi.fn(),
}));

vi.mock('@app/features/settings/computers/primitives/setup-notice', () => ({
  showComputerSetupNotice: mocks.showComputer,
}));
vi.mock('@app/features/settings/computers/primitives/setup-request', () => ({
  requestComputerSetup: vi.fn(),
}));
vi.mock('@app/features/settings/primitives/team-agent-setup-notice', () => ({
  showTeamAgentSetupFailure: mocks.showTeamAgentFailure,
}));
vi.mock('@app/features/settings/primitives/team-agent-status', () => ({
  retryTeamAgentComputer: mocks.retry,
}));
vi.mock('./notification-navigation', () => ({
  openBillingSettings: vi.fn(),
  openRuntimesSettings: vi.fn(),
}));

import type { ComputerSetupNotice } from '@app/features/settings/computers/primitives/setup-notice';
import { showComputerSetupToast } from './computer-setup-toast';

const ready: ComputerSetupNotice = {
  computerId: 'computer-1',
  harnessId: 'harness-1',
  computerName: 'Test computer',
  outcome: { kind: 'ready' },
};
const teammate = { userId: 'macro|example@agents.macro.invalid', name: 'Ada' };

beforeEach(() => {
  vi.clearAllMocks();
});

it('suppresses the ready toast for a teammate without suppressing normal computer setup', () => {
  showComputerSetupToast({ ...ready, agent: teammate });
  expect(mocks.showComputer).not.toHaveBeenCalled();
  expect(mocks.showTeamAgentFailure).not.toHaveBeenCalled();

  showComputerSetupToast(ready);
  expect(mocks.showComputer).toHaveBeenCalledWith(ready, expect.any(Function));
});

it('keeps the teammate failure notice and its retry on the same computer', () => {
  mocks.retry.mockResolvedValue(undefined);
  showComputerSetupToast({
    ...ready,
    agent: teammate,
    outcome: { kind: 'failed', failureReason: 'The computer could not start' },
  });

  expect(mocks.showTeamAgentFailure).toHaveBeenCalledWith(
    'computer-1',
    'Ada',
    'The computer could not start',
    expect.any(Function)
  );
  const retry = mocks.showTeamAgentFailure.mock.calls[0]?.[3];
  retry();
  expect(mocks.retry).toHaveBeenCalledWith('computer-1');
});
