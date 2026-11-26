import { expect, test } from 'bun:test';
import { createBrainAccessFixture } from './brain-access-fixture';

const sable = { viewer: 'preview-admin', team: 'sample-team', agent: 'sable' };
const quill = { ...sable, agent: 'quill' };
const login = 'req-sable-storybook';
const card = 'req-sable-font-card';

test('reads and decisions require the exact viewer, team, and agent', () => {
  const source = createBrainAccessFixture({
    teamId: 'sample-team',
    viewerId: sable.viewer,
    role: 'admin',
  });
  const wrongTeam = { ...sable, team: 'other-team' };
  const wrongAgent = { ...sable, agent: 'unknown' };

  const wrongViewer = { ...sable, viewer: 'preview-member' };

  expect(source.read(wrongViewer)).toBeUndefined();
  expect(
    source.decide(wrongViewer, { action: 'decline', requestId: login })
  ).toBe('unavailable');
  expect(source.read(wrongTeam)).toBeUndefined();
  expect(source.read(wrongAgent)).toBeUndefined();
  expect(
    source.decide(wrongTeam, { action: 'decline', requestId: login })
  ).toBe('unavailable');
  expect(
    source.decide(wrongAgent, { action: 'decline', requestId: login })
  ).toBe('unavailable');
  expect(source.decide(quill, { action: 'decline', requestId: login })).toBe(
    'unavailable'
  );
  expect(
    createBrainAccessFixture({
      teamId: 'other-team',
      viewerId: sable.viewer,
      role: 'admin',
    }).read(sable)
  ).toBeUndefined();
});

test('linking rechecks item team, kind, manager and existing grants', () => {
  const source = createBrainAccessFixture({
    teamId: 'sample-team',
    viewerId: sable.viewer,
    role: 'admin',
  });
  expect(source.read(sable)?.reviews[0]?.choices.map(({ id }) => id)).toEqual([
    'github',
    'portal',
  ]);
  const projectedGrant = source.read(sable)?.records[0];
  expect(projectedGrant).toBeDefined();
  if (projectedGrant) projectedGrant.itemId = 'unrelated';

  for (const itemId of [
    'foreign-login',
    'ops-card',
    'webhook-api',
    'figma',
    'linear',
    'unknown',
  ]) {
    expect(
      source.decide(sable, { action: 'link', requestId: login, itemId })
    ).toBe('denied');
  }

  const ownerScope = { ...sable, viewer: 'preview-owner' };
  const owner = createBrainAccessFixture({
    teamId: 'sample-team',
    viewerId: ownerScope.viewer,
    role: 'owner',
  });
  expect(
    owner.decide(ownerScope, {
      action: 'link',
      requestId: login,
      itemId: 'portal',
    })
  ).toBe('denied');
  expect(
    owner.decide(ownerScope, {
      action: 'link',
      requestId: login,
      itemId: 'github',
    })
  ).toBe('resolved');
  expect(
    owner.decide(ownerScope, {
      action: 'link',
      requestId: login,
      itemId: 'github',
    })
  ).toBe('denied');

  const memberScope = { ...sable, viewer: 'preview-member' };
  const member = createBrainAccessFixture({
    teamId: 'sample-team',
    viewerId: memberScope.viewer,
    role: 'member',
  });
  expect(
    member.decide(memberScope, {
      action: 'link',
      requestId: login,
      itemId: 'github',
    })
  ).toBe('denied');
});

test('only a scoped admin can add or decline a missing item', () => {
  for (const role of ['owner', 'member'] as const) {
    const scope = { ...sable, viewer: `preview-${role}` };
    const source = createBrainAccessFixture({
      teamId: 'sample-team',
      viewerId: scope.viewer,
      role,
    });
    expect(
      source.decide(scope, {
        action: 'add',
        requestId: login,
        itemName: 'Example',
      })
    ).toBe('denied');
    expect(source.decide(scope, { action: 'decline', requestId: card })).toBe(
      'denied'
    );
  }

  const source = createBrainAccessFixture({
    teamId: 'sample-team',
    viewerId: sable.viewer,
    role: 'admin',
  });
  expect(
    source.decide(sable, { action: 'add', requestId: login, itemName: ' ' })
  ).toBe('denied');
  expect(
    source.decide(sable, {
      action: 'add',
      requestId: login,
      itemName: 'Example',
    })
  ).toBe('resolved');
  expect(source.decide(sable, { action: 'decline', requestId: card })).toBe(
    'resolved'
  );
  expect(source.read(sable)?.reviews.map(({ outcome }) => outcome)).toEqual([
    { state: 'added' },
    { state: 'declined' },
  ]);
});

test('card matching and adding produce only an awaiting-human outcome', () => {
  const linked = createBrainAccessFixture({
    teamId: 'sample-team',
    viewerId: sable.viewer,
    role: 'admin',
  });
  expect(
    linked.decide(sable, {
      action: 'link',
      requestId: card,
      itemId: 'ops-card',
    })
  ).toBe('resolved');
  expect(linked.read(sable)?.reviews[1]?.outcome).toEqual({
    state: 'awaiting-human',
  });

  const added = createBrainAccessFixture({
    teamId: 'sample-team',
    viewerId: sable.viewer,
    role: 'admin',
  });
  expect(
    added.decide(sable, { action: 'add', requestId: card, itemName: 'Example' })
  ).toBe('resolved');
  expect(added.read(sable)?.reviews[1]?.outcome).toEqual({
    state: 'awaiting-human',
  });

  expect(
    createBrainAccessFixture({
      teamId: 'sample-team',
      viewerId: sable.viewer,
      role: 'admin',
    }).read(sable)?.reviews[1]?.outcome
  ).toBeUndefined();
});
