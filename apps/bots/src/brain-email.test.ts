import { describe, expect, test } from 'bun:test';
import {
  brainEmailFixtureScope,
  createFixtureBrainEmailReader,
} from './brain-email-fixture';
import {
  filterBrainEmailThreads,
  selectBrainEmailThread,
} from './brain-email-reader';
import { admitBrainFixture, readBrainFixture } from './brain-fixture';
import { readFleetRoster } from './fleet-data';
import { fleetFixture } from './fleet-fixture';

test('the scoped Fleet roster links to the Finch mailbox identity', async () => {
  const fleet = fleetFixture('');
  if (!fleet) throw new Error('Fleet unavailable');

  const roster = await readFleetRoster(fleet.reads, fleet.viewer);
  if (roster.status !== 'ready') throw new Error('Fleet roster unavailable');

  expect(
    roster.agents
      .filter(({ status }) => status !== 'provisioning')
      .map(({ userId }) => userId)
  ).toEqual(['sable', 'quill', 'atlas', 'ledger', 'scout', 'finch']);
  const finch = roster.agents.find(({ userId }) => userId === 'finch');
  if (!finch) throw new Error('Finch is absent from Fleet');

  const portrait = fleet.portraits.get(finch.userId);
  if (!portrait) throw new Error('Finch portrait is absent from Fleet');

  const scope = {
    viewer: fleet.viewer.viewerId,
    team: finch.teamId,
    agent: finch.userId,
  };
  expect(admitBrainFixture(scope)).toBe(true);
  expect(await readBrainFixture(scope)).toMatchObject({
    status: 'ready',
    snapshot: {
      scope,
      name: finch.name,
      role: finch.jobDescription,
      portrait: portrait.src,
    },
  });
  expect(
    await createFixtureBrainEmailReader().readInbox(
      scope,
      new AbortController().signal
    )
  ).toMatchObject({ status: 'provisioned', source: 'fixture' });
});

describe('Brain Email fixture reader', () => {
  test('returns 18 distinct inbox entries with separately readable message bodies', async () => {
    const reader = createFixtureBrainEmailReader();
    const { signal } = new AbortController();
    const inbox = await reader.readInbox(brainEmailFixtureScope, signal);

    expect(inbox.status).toBe('provisioned');
    if (inbox.status !== 'provisioned') throw new Error('Mailbox unavailable');

    expect(inbox.address).toBe('finch@example.com');
    expect(inbox.source).toBe('fixture');
    expect(inbox.threads).toHaveLength(18);
    expect(new Set(inbox.threads.map((thread) => thread.id)).size).toBe(18);
    expect(inbox.threads.map((thread) => thread.receivedAt)).toEqual(
      inbox.threads
        .map((thread) => thread.receivedAt)
        .sort()
        .reverse()
    );
    expect(inbox.threads[0]).not.toHaveProperty('messages');

    const threads = await Promise.all(
      inbox.threads.map(({ id }) =>
        reader.readThread(brainEmailFixtureScope, id, signal)
      )
    );
    const messages = threads.flatMap((thread) => thread?.messages ?? []);
    expect(messages).toHaveLength(18);
    expect(new Set(messages.map((message) => message.text)).size).toBe(18);
    expect(threads.every((thread) => thread?.to === inbox.address)).toBe(true);
  });

  test('denies inbox and thread reads outside the grant and hides unknown threads', async () => {
    const reader = createFixtureBrainEmailReader();
    const { signal } = new AbortController();
    const deniedScopes = [
      { viewer: 'sample-viewer', team: 'sample-team', agent: 'finch' },
      { viewer: 'hire-fixture-account', team: 'another-team', agent: 'finch' },
      { viewer: 'hire-fixture-account', team: 'sample-team', agent: 'sable' },
    ];

    for (const scope of deniedScopes) {
      expect(await reader.readInbox(scope, signal)).toEqual({
        status: 'unavailable',
      });
      expect(await reader.readThread(scope, 'mail-01', signal)).toBeUndefined();
    }

    expect(
      await reader.readThread(brainEmailFixtureScope, 'missing', signal)
    ).toBeUndefined();
    const cancelled = AbortSignal.abort();
    expect(await reader.readInbox(brainEmailFixtureScope, cancelled)).toEqual({
      status: 'unavailable',
    });
    expect(
      await reader.readThread(brainEmailFixtureScope, 'mail-01', cancelled)
    ).toBeUndefined();
  });

  test('filters visible senders and subjects and keeps the selected thread only while visible', async () => {
    const reader = createFixtureBrainEmailReader();
    const inbox = await reader.readInbox(
      brainEmailFixtureScope,
      new AbortController().signal
    );
    if (inbox.status !== 'provisioned') throw new Error('Mailbox unavailable');

    const filtered = filterBrainEmailThreads(inbox.threads, '  acme SECURITY ');
    expect(filtered.map((thread) => thread.id)).toEqual(['mail-01', 'mail-13']);
    expect(selectBrainEmailThread(filtered, 'mail-13')?.id).toBe('mail-13');
    expect(selectBrainEmailThread(filtered, 'mail-18')?.id).toBe('mail-01');
    expect(
      filterBrainEmailThreads(inbox.threads, 'routing').map(
        (thread) => thread.id
      )
    ).toEqual(['mail-18']);
    expect(
      selectBrainEmailThread(
        filterBrainEmailThreads(inbox.threads, 'staging pool'),
        'mail-18'
      )
    ).toBeUndefined();
    expect(selectBrainEmailThread(inbox.threads, 'mail-18')?.id).toBe(
      'mail-18'
    );
  });
});
