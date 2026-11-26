import { describe, expect, it, mock } from 'bun:test';
import type { ComputerStatus, TeamAgent } from '@macro-inc/sdk/generated/auth';
import {
  type FleetReadPorts,
  type FleetScope,
  type FleetViewer,
  lifecycleLabel,
  offlineFleetReads,
  readFleetComputers,
  readFleetRoster,
} from './fleet-data';
import { scopedBrainPath } from './routes';

const viewer: FleetViewer = {
  viewerId: 'viewer',
  teamId: 'team',
  teamName: 'Fixture',
  role: 'owner',
  teammateRollout: 'on',
  computerRollout: 'on',
};
const agent: TeamAgent = {
  userId: 'teammate',
  teamId: 'team',
  computerId: 'linked',
  createdAt: '2026-01-01T00:00:00Z',
  name: 'Sable',
  jobDescription: 'Design handoffs',
  personality: '',
  status: 'starting',
};
const computer: ComputerStatus = {
  id: 'linked',
  defaultAgentId: 'different-coding-agent',
  agentCount: 1,
  canRestore: false,
  canUndoCancel: false,
  catalogEntry: 'fixture',
  createdAt: '2026-01-01T00:00:00Z',
  diskGib: 100,
  memoryGib: 8,
  name: 'Fixture computer',
  poweredOn: true,
  purchasedBy: 'different-admin',
  size: 'standard',
  status: 'ready',
  vcpus: 4,
};

const reads: FleetReadPorts = {
  async readRoster(scope) {
    return { status: 'ready', scope, value: { agents: [agent] } };
  },
  async readComputers(scope) {
    return { status: 'ready', scope, value: [computer] };
  },
};

describe('scoped Fleet reads', () => {
  it('keeps lifecycle authoritative over same-VM readiness and encodes Hub identity', async () => {
    expect(await readFleetRoster(reads, viewer)).toEqual({
      status: 'ready',
      agents: [agent],
      canHire: true,
    });
    const computers = await readFleetComputers(reads, viewer);
    expect(computers.get(agent.computerId ?? '')).toEqual(computer);
    expect(computers.get('different-coding-agent')).toBeUndefined();
    expect(lifecycleLabel[agent.status]).toBe('Setting up');
    expect(scopedBrainPath('team/other', 'id#next')).toBe(
      '/teams/team%2Fother/bots/id%23next/overview'
    );
  });

  it('delivers the exact roster without requiring compute to settle', async () => {
    const readComputers = mock(async () => {
      throw new Error('Unavailable');
    });
    const ports = { ...reads, readComputers };
    expect(await readFleetRoster(ports, viewer)).toMatchObject({
      status: 'ready',
      agents: [agent],
    });
    expect(readComputers).not.toHaveBeenCalled();
    expect(await readFleetComputers(ports, viewer)).toEqual(new Map());
    expect(
      await readFleetComputers(
        {
          ...reads,
          async readComputers() {
            return {
              status: 'ready',
              scope: { ...viewer, teamId: 'other' },
              value: [computer],
            };
          },
        },
        viewer
      )
    ).toEqual(new Map());
  });

  it('keeps denied, failed, or mixed rosters distinct from empty', async () => {
    expect(await readFleetRoster(offlineFleetReads, viewer)).toEqual({
      status: 'unavailable',
    });
    expect(
      await readFleetRoster(
        {
          ...reads,
          async readRoster(scope) {
            return {
              status: 'ready',
              scope,
              value: { agents: [agent, { ...agent, teamId: 'other' }] },
            };
          },
        },
        viewer
      )
    ).toEqual({ status: 'denied' });
    expect(
      await readFleetRoster(
        {
          ...reads,
          async readRoster() {
            return { status: 'denied' };
          },
        },
        viewer
      )
    ).toEqual({ status: 'denied' });
  });

  it('requires a resolved active scope and both gates before offering hire', async () => {
    const readRoster = mock((scope: FleetScope) => reads.readRoster(scope));
    const readComputers = mock((scope: FleetScope) =>
      reads.readComputers(scope)
    );
    const ports = { readRoster, readComputers };
    expect(
      await readFleetRoster(ports, { ...viewer, teammateRollout: 'unknown' })
    ).toEqual({ status: 'denied' });
    expect(readRoster).not.toHaveBeenCalled();
    expect(
      await readFleetComputers(ports, { ...viewer, computerRollout: 'unknown' })
    ).toEqual(new Map());
    expect(readComputers).not.toHaveBeenCalled();
    expect(
      await readFleetRoster(ports, { ...viewer, computerRollout: 'unknown' })
    ).toMatchObject({ canHire: false });
    expect(
      await readFleetRoster(ports, { ...viewer, role: 'member' })
    ).toMatchObject({ canHire: false });
    expect(
      await readFleetRoster(ports, { ...viewer, role: 'admin' })
    ).toMatchObject({ canHire: true });
  });
});
