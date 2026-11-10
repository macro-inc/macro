import type {
  PeopleContextState,
  PeopleContextUpdate,
} from '@graphql-cache/people/generated';
import { parseCacheRevision } from '@graphql-cache/protocol';
import { expect, it, vi } from 'vitest';
import { EMPTY_PERSON_FACTS, type PersonFacts } from './context-facts';
import {
  ContactContextCanceled,
  ContactContextPublisher,
} from './context-publisher';

const SCOPE = {
  identity: 'macro|viewer@example.com',
  storageGeneration: '00000000-0000-4000-8000-000000000001',
};
const FIRST = { ...EMPTY_PERSON_FACTS, lastInteractionMs: 1 };
const SECOND = { ...EMPTY_PERSON_FACTS, lastInteractionMs: 2 };

// Publication/epoch behavior is also covered by real native and OPFS engine tests.
// This port controls ack loss/interleaving, which those engines cannot schedule.
function cachePort() {
  let state: PeopleContextState = { kind: 'missing' };
  let revision = 0;
  const rows = new Map<string, { epoch: string; facts: PersonFacts }>();
  const writes: PeopleContextUpdate[] = [];
  return {
    rows,
    writes,
    state: () => state,
    context: vi.fn(async () => state),
    update: vi.fn(async (update: PeopleContextUpdate) => {
      writes.push(update);
      const oldEpoch = state.kind === 'missing' ? null : state.epoch;
      if (update.action.kind === 'begin') {
        if (update.action.previousEpoch !== oldEpoch)
          throw new Error('contact search context changed');
        state = { kind: 'building', epoch: update.epoch };
      } else {
        if (update.epoch !== oldEpoch)
          throw new Error('contact search context changed');
        if (update.action.kind === 'patch') {
          expect(update.action.updates.length).toBeLessThanOrEqual(500);
          for (const patch of update.action.updates)
            rows.set(patch.userId, { epoch: update.epoch, facts: patch.facts });
        } else state = { kind: 'ready', epoch: update.epoch };
      }
      return parseCacheRevision(String(++revision));
    }),
  };
}

it('publishes a large snapshot in bounded writes, then only changed and removed peers', async () => {
  const cache = cachePort();
  const publisher = new ContactContextPublisher(cache, SCOPE, () => true);
  const source = new Map<string, PersonFacts>();
  for (let i = 0; i < 1201; i++)
    source.set(`macro|peer${i}@example.com`, FIRST);
  publisher.replace(source);
  expect(await publisher.flush()).toBe('ready');
  expect(
    cache.writes.map((write) =>
      write.action.kind === 'patch'
        ? write.action.updates.length
        : write.action.kind
    )
  ).toEqual(['begin', 500, 500, 201, 'commit']);
  const changed = new Map(source);
  changed.set('macro|peer0@example.com', SECOND);
  changed.delete('macro|peer1@example.com');
  cache.writes.length = 0;
  publisher.replace(changed);
  await publisher.flush();
  expect(cache.writes.map((write) => write.action)).toEqual([
    {
      kind: 'patch',
      updates: [
        { userId: 'macro|peer0@example.com', facts: SECOND },
        { userId: 'macro|peer1@example.com', facts: EMPTY_PERSON_FACTS },
      ],
    },
  ]);
  publisher.replace(new Map(changed));
  await publisher.flush();
  expect(cache.writes).toHaveLength(1);
});

it('keeps a newer update to an in-flight dirty ID until its own ack', async () => {
  const cache = cachePort();
  const publisher = new ContactContextPublisher(cache, SCOPE, () => true);
  publisher.replace(new Map([['macro|peer@example.com', FIRST]]));
  await publisher.flush();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const apply = cache.update.getMockImplementation()!;
  cache.update.mockImplementationOnce(async (update) => {
    entered.resolve();
    await release.promise;
    return apply(update);
  });
  publisher.replace(new Map([['macro|peer@example.com', SECOND]]));
  const writing = publisher.flush();
  await entered.promise;
  publisher.replace(
    new Map([['macro|peer@example.com', { ...SECOND, secondaryInbox: true }]])
  );
  expect(publisher.pendingCount).toBe(1);
  release.resolve();
  await writing;
  expect(cache.rows.get('macro|peer@example.com')?.facts.secondaryInbox).toBe(
    true
  );
  expect(publisher.pendingCount).toBe(0);
});

it('caps queued dirty IDs and replaces an overflowing in-flight snapshot before publication', async () => {
  const cache = cachePort();
  const publisher = new ContactContextPublisher(cache, SCOPE, () => true);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const apply = cache.update.getMockImplementation()!;
  cache.update.mockImplementationOnce(async (update) => {
    entered.resolve();
    await release.promise;
    return apply(update);
  });
  publisher.replace(new Map([['macro|old@example.com', FIRST]]));
  const publishing = publisher.flush();
  await entered.promise;
  const replacement = new Map<string, PersonFacts>();
  for (let i = 0; i < 1002; i++)
    replacement.set(`macro|next${i}@example.com`, SECOND);
  publisher.replace(replacement);
  expect(publisher.pendingCount).toBeLessThanOrEqual(500);
  release.resolve();
  await publishing;
  expect(
    cache.writes.filter((write) => write.action.kind === 'commit')
  ).toHaveLength(1);
  const published = cache.state();
  if (published.kind !== 'ready') throw new Error('Expected publication');
  expect(
    [...cache.rows.values()].filter((row) => row.epoch === published.epoch)
  ).toHaveLength(1002);
});

it('starts a fresh epoch after an uncertain write rather than replaying stale batches', async () => {
  const cache = cachePort();
  const publisher = new ContactContextPublisher(cache, SCOPE, () => true);
  publisher.replace(new Map([['macro|old@example.com', FIRST]]));
  await publisher.flush();
  const original = cache.state();
  const apply = cache.update.getMockImplementation()!;
  cache.update.mockImplementationOnce(async (update) => {
    await apply(update);
    throw new Error('lost ack');
  });
  publisher.replace(new Map([['macro|old@example.com', SECOND]]));
  await expect(publisher.flush()).rejects.toThrow('lost ack');
  publisher.replace(new Map([['macro|new@example.com', FIRST]]));
  await publisher.flush();
  const published = cache.state();
  expect(published).not.toEqual(original);
  if (published.kind !== 'ready') throw new Error('Expected publication');
  expect(cache.rows.get('macro|old@example.com')?.epoch).not.toBe(
    published.epoch
  );
  expect(cache.rows.get('macro|new@example.com')?.epoch).toBe(published.epoch);
});

it('does not commit after disposal or an account fence fails while a write is pending', async () => {
  const cache = cachePort();
  let current = true;
  const publisher = new ContactContextPublisher(cache, SCOPE, () => current);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const apply = cache.update.getMockImplementation()!;
  cache.update.mockImplementationOnce(async (update) => {
    entered.resolve();
    await release.promise;
    return apply(update);
  });
  publisher.replace(new Map([['macro|peer@example.com', FIRST]]));
  const writing = publisher.flush();
  const rejected = expect(writing).rejects.toBeInstanceOf(
    ContactContextCanceled
  );
  await entered.promise;
  current = false;
  publisher.dispose();
  release.resolve();
  await rejected;
  expect(cache.writes.map((write) => write.action.kind)).toEqual(['begin']);
});

it('treats missing inputs as waiting, known empty inputs as a snapshot, and unsupported as terminal', async () => {
  const cache = cachePort();
  const publisher = new ContactContextPublisher(cache, SCOPE, () => true);
  expect(await publisher.flush()).toBe('waiting');
  expect(cache.context).not.toHaveBeenCalled();
  publisher.replace(new Map());
  expect(await publisher.flush()).toBe('ready');
  expect(cache.writes.map((write) => write.action.kind)).toEqual([
    'begin',
    'commit',
  ]);
  const unsupported = {
    context: vi.fn(async () => ({ kind: 'unsupported' as const })),
    update: vi.fn(),
  };
  const old = new ContactContextPublisher(unsupported, SCOPE, () => true);
  old.replace(new Map());
  expect(await old.flush()).toBe('unsupported');
  old.replace(new Map([['macro|peer@example.com', FIRST]]));
  expect(await old.flush()).toBe('unsupported');
  expect(unsupported.context).toHaveBeenCalledOnce();
  expect(unsupported.update).not.toHaveBeenCalled();
});
