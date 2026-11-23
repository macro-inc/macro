import { expect, test } from 'bun:test';
import type { Agent, WakeContext, Woke } from '@macro-inc/muppet/core/agent';
import { memoryDisk } from '../../context/test/fakes.ts';
import { authority, authorized, type Team } from '../authority.ts';

const creator = 'macro|creator@example.com';
const teamOwner = 'macro|team-owner@example.com';
const files = {
  current: '/run/authority/owner',
  told: '/memory/authority/told',
};

test('the configured owner stays the authority while they are on the team', async () => {
  const told: [string, string][] = [];
  const owners = authority({
    configured: creator,
    team: async () => ({ owner: teamOwner, members: [teamOwner, creator] }),
    disk: memoryDisk(),
    files,
    tell: async (to, text) => {
      told.push([to, text]);
    },
  });

  await owners.refresh();

  expect(owners.owner()).toBe(creator);
  expect(told).toEqual([]);
});

test('an owner who left the team gives way to the team owner, who is told once', async () => {
  const disk = memoryDisk();
  const told: [string, string][] = [];
  const left: Team = { owner: teamOwner, members: [teamOwner] };
  const make = () =>
    authority({
      configured: creator,
      team: async () => left,
      disk,
      files,
      tell: async (to, text) => {
        told.push([to, text]);
      },
    });
  const owners = make();

  await owners.refresh();
  await owners.refresh();
  // A restart reads what was decided and told before.
  await make().refresh();

  expect(owners.owner()).toBe(teamOwner);
  expect(told.length).toBe(1);
  expect(told[0]?.[0]).toBe(teamOwner);
  expect(await disk.read(files.current)).toBe(`${teamOwner}\n`);
});

test('an owner who rejoins is the authority again, and a second departure is told again', async () => {
  const told: string[] = [];
  let team: Team = { owner: teamOwner, members: [teamOwner] };
  const owners = authority({
    configured: creator,
    team: async () => team,
    disk: memoryDisk(),
    files,
    tell: async (to) => {
      told.push(to);
    },
  });

  await owners.refresh();
  team = { owner: teamOwner, members: [teamOwner, creator] };
  await owners.refresh();
  expect(owners.owner()).toBe(creator);
  team = { owner: teamOwner, members: [teamOwner] };
  await owners.refresh();

  expect(owners.owner()).toBe(teamOwner);
  expect(told).toEqual([teamOwner, teamOwner]);
});

test('a team that cannot be read keeps the last decision', async () => {
  let readable = true;
  const owners = authority({
    configured: creator,
    team: async () => {
      if (!readable) throw new Error('team service down');
      return { owner: teamOwner, members: [teamOwner] };
    },
    disk: memoryDisk(),
    files,
    tell: async () => {},
  });

  await owners.refresh();
  readable = false;
  await owners.refresh();

  expect(owners.owner()).toBe(teamOwner);
});

test('the authority is checked before every wake', async () => {
  let checks = 0;
  const woke: Woke = { kind: 'done', text: '' } as unknown as Woke;
  const inner: Agent = { wake: async () => woke };
  const agent = authorized({
    agent: inner,
    authority: {
      owner: () => creator,
      refresh: async () => {
        checks += 1;
      },
    },
  });

  await agent.wake({} as WakeContext);
  await agent.wake({} as WakeContext);

  expect(checks).toBe(2);
});
