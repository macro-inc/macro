import type { Harness } from '@service-storage/client';
import { expect, it } from 'vitest';
import { runnableHarnesses } from './runnable';

const laptop: Harness = {
  allow_permission_bypass: false,
  id: '0198a805-3e22-75b2-97eb-d9c6b91accb0',
  kind: 'macrod',
  name: 'erics-macbook',
  owner: { type: 'user', user_id: 'macro|owner@example.com' },
  access: 'owner',
  shared_team_ids: [],
  created_by: 'macro|owner@example.com',
  created_at: '2026-11-13T00:00:00Z',
  updated_at: '2026-11-13T00:00:00Z',
  connected: true,
  last_connected_at: '2026-11-13T00:00:00Z',
  computer_id: null,
  team_agent_user_id: null,
  claude_mode: 'macro_credits',
};

const teamComputer: Harness = {
  ...laptop,
  id: '0198a805-3e22-75b2-97eb-d9c6b91accb1',
  name: 'Team computer',
  computer_id: '0198a805-3e22-75b2-97eb-d9c6b91acc01',
};

const adasComputer: Harness = {
  ...laptop,
  id: '0198a805-3e22-75b2-97eb-d9c6b91accb2',
  name: "Ada's computer",
  computer_id: '0198a805-3e22-75b2-97eb-d9c6b91acc02',
  team_agent_user_id: 'macro|agent@example.com',
};

it("keeps an agent teammate's computer out of the runtimes agents run on", () => {
  expect(runnableHarnesses([laptop, adasComputer, teamComputer])).toEqual([
    laptop,
    teamComputer,
  ]);
});
