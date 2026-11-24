import type { ComputerStatus } from '@service-auth/computers';
import { afterEach, describe, expect, it } from 'vitest';
import { forgetSetupTiming } from '../computers/core/setup-progress';
import {
  teamAgentComputer,
  teamAgentRunState,
  teamAgentSetupStep,
} from './team-agent-setup';

const computer: ComputerStatus = {
  id: 'computer-ada',
  name: 'Ada',
  size: 'standard',
  vcpus: 4,
  memoryGib: 8,
  diskGib: 100,
  catalogEntry: 'standard@2026-11',
  status: 'setting_up',
  billing: 'active',
  setup: { step: 'booting', position: 2, total: 4 },
  poweredOn: false,
  agentCount: 0,
  canUndoCancel: false,
  canRestore: false,
  purchasedBy: 'macro|maya@example.com',
  createdAt: '2026-11-13T09:00:00Z',
};

afterEach(() => forgetSetupTiming(computer.id));

describe('teamAgentRunState', () => {
  it('reads a status this build does not know as not running', () => {
    const unknown = JSON.parse('{"status":"hibernating"}');
    expect(teamAgentRunState(unknown)).toBe('not_running');
  });

  it('follows the computer while it is being set up, failed, off, or gone', () => {
    expect(teamAgentRunState({ status: 'provisioning' })).toBe('setting_up');
    // The computer is up but the agent hasn't come online yet.
    expect(teamAgentRunState({ status: 'starting' })).toBe('setting_up');
    expect(teamAgentRunState({ status: 'failed' })).toBe('setup_failed');
    expect(teamAgentRunState({ status: 'paused' })).toBe('offline');
    expect(teamAgentRunState({ status: 'released' })).toBe('not_running');
    expect(teamAgentRunState({ status: 'running' })).toBe('running');
  });

  // `unhealthy` is the server's word for a computer past setup that a fleet
  // check found unreachable, or that crashed and is restarting.
  it('reads an unhealthy agent as offline for every member', () => {
    expect(teamAgentRunState({ status: 'unhealthy' })).toBe('offline');
  });
});

describe('teamAgentSetupStep', () => {
  it('names the step the computer is on', () => {
    expect(teamAgentSetupStep(computer)).toBe('Starting up');
    expect(
      teamAgentSetupStep({
        ...computer,
        status: 'purchasing',
        billing: 'purchasing',
        setup: { step: 'billing', position: 0, total: 4 },
      })
    ).toBe('Updating billing…');
  });

  it('has no step once the computer is up or setup has failed', () => {
    expect(
      teamAgentSetupStep({ ...computer, status: 'ready', setup: undefined })
    ).toBeUndefined();
    expect(
      teamAgentSetupStep({ ...computer, status: 'failed' })
    ).toBeUndefined();
    expect(teamAgentSetupStep(undefined)).toBeUndefined();
  });
});

describe('teamAgentComputer', () => {
  it("finds the agent's computer, and none before it is bought", () => {
    expect(teamAgentComputer({ computerId: 'computer-ada' }, [computer])).toBe(
      computer
    );
    expect(teamAgentComputer({ computerId: null }, [computer])).toBeUndefined();
  });
});
