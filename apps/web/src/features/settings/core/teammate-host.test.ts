import type { TeammateHost } from '@service-auth/team-agents';
import { describe, expect, it } from 'vitest';
import {
  canMoveTeammate,
  firstEligibleHost,
  hostEngineLabel,
  hostUnavailableReason,
  sortedHosts,
} from './teammate-host';

const host = (overrides: Partial<TeammateHost>): TeammateHost => ({
  harnessId: 'harness-1',
  name: 'laptop',
  connected: true,
  experimental: false,
  report: {
    engine: { kind: 'podman', version: '5.2.0', rootless: true },
    engines: [],
    os: 'linux',
    arch: 'amd64',
    cpus: 8,
    memoryMib: 16384,
    diskFreeMib: 100000,
  },
  eligibility: { ok: true },
  ...overrides,
});

describe('teammate hosts', () => {
  it('says nothing about a machine that can host an agent', () => {
    expect(hostUnavailableReason(host({}))).toBeUndefined();
  });

  it('names the short resource of a machine below the floor', () => {
    expect(
      hostUnavailableReason(
        host({
          eligibility: { ok: false, reason: 'belowFloor', resource: 'disk' },
        })
      )
    ).toBe('Needs at least 20 GB free');
  });

  it('tells the owner what to install when there is no engine', () => {
    expect(
      hostUnavailableReason(
        host({ eligibility: { ok: false, reason: 'noEngine' } })
      )
    ).toBe('Install Podman or Docker to host agents here');
  });

  it('says a machine that cannot lock down an agent network is unavailable', () => {
    expect(
      hostUnavailableReason(
        host({
          eligibility: { ok: false, reason: 'networkIsolationUnavailable' },
        })
      )
    ).toBe("Can't lock down an agent's network on this machine");
  });

  it('labels the engine with its version and whether it is rootless', () => {
    expect(hostEngineLabel(host({}))).toBe('Podman 5.2.0 · rootless');
    expect(hostEngineLabel(host({ report: null }))).toBeUndefined();
  });

  it('lists machines that can host first, then by name', () => {
    const offline = host({
      harnessId: 'a',
      name: 'aardvark',
      connected: false,
      eligibility: { ok: false, reason: 'offline' },
    });
    const zebra = host({ harnessId: 'z', name: 'zebra' });
    const bee = host({ harnessId: 'b', name: 'bee' });
    expect(sortedHosts([offline, zebra, bee]).map((item) => item.name)).toEqual(
      ['bee', 'zebra', 'aardvark']
    );
    expect(firstEligibleHost([offline, zebra, bee])?.harnessId).toBe('b');
    expect(firstEligibleHost([offline])).toBeUndefined();
  });

  it('lets only the inviter or the machine it runs on move an agent', () => {
    const agent = { createdBy: 'macro|a@x.test', harnessId: 'laptop-a' };
    expect(
      canMoveTeammate(agent, 'macro|a@x.test', [], { ownsTeam: false })
    ).toBe(true);
    expect(
      canMoveTeammate(agent, 'macro|b@x.test', ['laptop-a'], {
        ownsTeam: false,
      })
    ).toBe(true);
    expect(
      canMoveTeammate(agent, 'macro|b@x.test', ['laptop-b'], {
        ownsTeam: true,
      })
    ).toBe(false);
    expect(
      canMoveTeammate({ ...agent, harnessId: null }, 'macro|a@x.test', [], {
        ownsTeam: false,
      })
    ).toBe(false);
  });

  it('lets only the inviter, the team owner or the host owner move a parked agent', () => {
    const parked = {
      createdBy: 'macro|a@x.test',
      harnessId: 'laptop-b',
      installProblem: { kind: 'hostRemoved' as const },
    };
    const viewer = { ownsTeam: false };
    // Another admin: its new machine would get the agent's DMs and shares.
    expect(
      canMoveTeammate(parked, 'macro|c@x.test', ['laptop-c'], viewer)
    ).toBe(false);
    expect(canMoveTeammate(parked, 'macro|a@x.test', [], viewer)).toBe(true);
    expect(
      canMoveTeammate(parked, 'macro|o@x.test', [], { ownsTeam: true })
    ).toBe(true);
    // The machine it was parked off, still paired, its owner an admin again.
    expect(
      canMoveTeammate(parked, 'macro|b@x.test', ['laptop-b'], viewer)
    ).toBe(true);
    expect(canMoveTeammate(parked, undefined, [], { ownsTeam: true })).toBe(
      false
    );
  });
});
