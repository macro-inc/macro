import { expect, test } from 'bun:test';
import {
  fixtureCheckout,
  hireFleetPath,
  hireReceipt,
  hireReceiptFor,
  saveHireReceipt,
  selectedHireReceipt,
} from './hire-fixture';
import { scopedBrainPath } from './routes';

test('only this tab’s verified mock receipt selects the exact Hire identity', async () => {
  const scope = await fixtureCheckout.readScope();
  if (scope.status !== 'signed-in') throw new Error('Expected a fixture team');
  const intent = {
    scope,
    request: {
      purchaseKey: 'fixture-purchase',
      name: 'Sample',
      size: 'standard',
    },
  };
  const result = await fixtureCheckout.submit(intent);
  if (result.status !== 'accepted')
    throw new Error('Expected a fixture receipt');
  const { agent } = result;

  expect(agent.teamId).toBe(scope.team);
  expect(agent.userId).not.toBe(intent.request.purchaseKey);
  expect(agent.status).toBe('provisioning');
  expect(await fixtureCheckout.submit(intent)).toEqual(result);
  expect(hireReceiptFor(agent.teamId, agent.userId)).toBeUndefined();
  saveHireReceipt({
    agent: { ...agent },
    portrait: 'sample-portrait',
    width: 3,
  });
  expect(hireReceipt()).toBeUndefined();

  saveHireReceipt({ agent, portrait: 'sample-portrait', width: 3 });
  const path = new URL(hireFleetPath(agent), 'https://fixture.invalid');
  const receipt = selectedHireReceipt(path.search);
  expect(receipt).toEqual({ agent, portrait: 'sample-portrait', width: 3 });
  expect(hireReceiptFor(agent.teamId, agent.userId)).toBe(receipt);
  expect(hireReceiptFor('other-team', agent.userId)).toBeUndefined();
  expect(hireReceiptFor(agent.teamId, 'other-agent')).toBeUndefined();
  expect(selectedHireReceipt(`${path.search}&bot=other-agent`)).toBeUndefined();
  expect(scopedBrainPath(agent.teamId, agent.userId)).toBe(
    `/teams/${agent.teamId}/bots/${agent.userId}/overview`
  );
});

test('scoped Brain paths encode both identity segments', () => {
  expect(
    scopedBrainPath(
      'team/with scope',
      'macro|fixture@example.invalid',
      'activity'
    )
  ).toBe(
    '/teams/team%2Fwith%20scope/bots/macro%7Cfixture%40example.invalid/activity'
  );
});
