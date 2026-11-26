import { expect, test } from 'bun:test';
import { fixtureViewer, readBrainFixture } from './brain-fixture';
import {
  type BrainObservation,
  dailyJournal,
  readScopedBrain,
  visibleActivity,
} from './brain-model';
import { fixtureTeam, parseBrainRoute, scopedBrainPath } from './routes';

const scope = { viewer: fixtureViewer, team: fixtureTeam, agent: 'sable' };

test('the fixture reader fails closed for each wrong scope dimension', async () => {
  expect(await readScopedBrain(readBrainFixture, scope)).toMatchObject({
    status: 'ready',
    snapshot: { scope },
  });

  for (const wrong of [
    { ...scope, viewer: 'another-viewer' },
    { ...scope, team: 'another-team' },
    { ...scope, agent: 'unknown-agent' },
    { ...scope, agent: '__proto__' },
  ]) {
    expect(await readScopedBrain(readBrainFixture, wrong)).toEqual({
      status: 'unavailable',
    });
  }
});

test('an authorized Fleet agent without journal data remains empty', async () => {
  const current = { ...scope, agent: 'ledger' };
  expect(await readScopedBrain(readBrainFixture, current)).toMatchObject({
    status: 'ready',
    snapshot: {
      scope: current,
      lifecycle: 'Degraded',
      workStatus: 'Unavailable',
      activity: [],
    },
  });
});

test('a source returning another agent or failing cannot populate the requested scope', async () => {
  const foreign = await readBrainFixture({ ...scope, agent: 'quill' });
  expect(await readScopedBrain(async () => foreign, scope)).toEqual({
    status: 'unavailable',
  });
  expect(
    await readScopedBrain(async () => {
      throw new Error('fixture source failure');
    }, scope)
  ).toEqual({ status: 'unavailable' });
});

test('fixture journal keeps one completed item per source and excludes denied rows and earlier days', async () => {
  const read = await readBrainFixture(scope);
  if (read.status !== 'ready') throw new Error('Sable fixture unavailable');

  expect(read.snapshot.activity.map(({ id }) => id)).toEqual([
    'panel-contrast',
    'component-checklist',
    'desktop-baseline',
    'dense-grid-padding',
  ]);
  const journal = dailyJournal(read.snapshot.activity, '2026-11-25');
  expect(journal.completed.map(({ id }) => id)).toEqual([
    'component-checklist',
    'desktop-baseline',
  ]);
  expect(journal.updatedAt).toBe('2026-11-25T10:00:00Z');
  expect(dailyJournal(read.snapshot.activity, '2026-11-26')).toEqual({
    completed: [],
    updatedAt: '',
  });
});

test('a denied source suppresses older and same-revision observations', () => {
  const visible: BrainObservation = {
    id: 'work-1',
    title: 'Existing completed work',
    source: '#fixture',
    occurredAt: '2026-11-25T09:00:00Z',
    observedAt: '2026-11-25T10:00:00Z',
    outcome: 'Completed',
    visibility: 'visible',
    canOpen: true,
  };
  const denied = { ...visible, visibility: 'denied' as const };
  expect(visibleActivity([visible, denied, visible])).toEqual([]);
  expect(
    visibleActivity([
      visible,
      { ...denied, observedAt: '2026-11-25T10:30:00Z' },
      visible,
    ])
  ).toEqual([]);
});

test('routes require the canonical viewer destination and exact scoped activity id', () => {
  const quill = {
    team: fixtureTeam,
    bot: 'quill',
    view: 'activity',
    entry: 'release-summary',
  };
  const pathname = '/teams/sample-team/bots/quill/activity/release-summary';
  expect(parseBrainRoute(pathname, quill)).toEqual({
    team: fixtureTeam,
    agent: 'quill',
    view: 'activity',
    entry: 'release-summary',
  });

  expect(parseBrainRoute(pathname, { ...quill, bot: 'sable' })).toBeUndefined();
  expect(
    parseBrainRoute(pathname, { ...quill, entry: 'weekly-launch' })
  ).toBeUndefined();
  expect(
    parseBrainRoute('/teams/sample-team/bots/quill/email/release-summary', {
      ...quill,
      view: 'email',
    })
  ).toBeUndefined();
  expect(
    parseBrainRoute(pathname, { ...quill, view: 'constructor' })
  ).toBeUndefined();
  const encoded = scopedBrainPath(fixtureTeam, 'macro|fixture');
  expect(
    parseBrainRoute(encoded, {
      ...quill,
      view: 'overview',
      entry: undefined,
      bot: 'macro%7Cfixture',
    })?.agent
  ).toBe('macro|fixture');
  for (const bot of ['sable%2Fquill', 'sable%', '%73able']) {
    expect(
      parseBrainRoute(`/teams/sample-team/bots/${bot}/overview`, {
        ...quill,
        view: 'overview',
        entry: undefined,
        bot,
      })
    ).toBeUndefined();
  }
  expect(scopedBrainPath(fixtureTeam, 'macro|fixture')).toBe(
    '/teams/sample-team/bots/macro%7Cfixture/overview'
  );
});
