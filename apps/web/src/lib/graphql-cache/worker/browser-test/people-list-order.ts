// The production directory reader over the real app host wrapper, coordinator
// and WASM/OPFS engine, ordering a mention window by contact list. Only the
// contacts and their lists are synthetic.
import { contactRecordKey } from '@queries/contacts/contact-key';
import { readContactDirectory } from '@queries/contacts/directory';
import { MENTION_LIST_PRIORITY } from '@queries/contacts/list-priority';
import { createRetirableCacheHost } from '../../host/retirable-host';
import type { CacheHost } from '../../host/types';
import { createWorkerCacheHost } from '../../host/worker-host';
import { captureContactWriteScope } from '../../people/sync';

/** Lists by contact name; everyone else is in none. */
const LISTS: Record<string, string[]> = {
  'Sam 900': ['gmail'],
  'Sam 901': ['interacted'],
  'Sam 902': ['teammates'],
  'Sam 903': ['invited'],
  'Sam 904': ['outlook', 'teammates'],
  'Sam 905': ['someday'],
};
const NAMES = ['Sam 90', ...Object.keys(LISTS), 'Sam 906', 'Sam 907'];

const output = document.querySelector<HTMLPreElement>('#result');
if (!output) throw new Error('Missing list order result element');
const physical = createRetirableCacheHost(
  createWorkerCacheHost({ scope: `people-list-order-${crypto.randomUUID()}` })
);
window.addEventListener('pagehide', () => physical.dispose(), { once: true });
try {
  const viewer = 'macro|viewer@example.com';
  const scope = {
    identity: viewer,
    storageGeneration: await physical.currentStorageGeneration(),
  };
  const people = physical.people;
  if (!people) throw new Error('Missing person capability through app wrapper');
  const guarded = await captureContactWriteScope(
    physical,
    scope,
    new AbortController().signal
  );
  if (!guarded) throw new Error('Missing contact admission');
  await physical.hydrateQuery({
    generation: (await physical.authority!.current()).generation,
    query:
      '{ user { id contacts(limit: 50) { nodes { __typename id userId name email lists } nextCursor } } }',
    data: {
      user: {
        id: viewer,
        contacts: {
          nodes: NAMES.map((name) => {
            const userId = `macro|${name.replace(' ', '').toLowerCase()}@example.com`;
            return {
              __typename: 'GraphqlContact',
              id: contactRecordKey(viewer, userId).slice(
                'GraphqlContact:'.length
              ),
              userId,
              email: userId.slice('macro|'.length),
              name,
              lists: LISTS[name] ?? [],
            };
          }),
          nextCursor: null,
        },
      },
    },
    identity: viewer,
    hydrationScope: guarded,
  });

  // Searches wait for the viewer's direct-message context; this one has none.
  const epoch = crypto.randomUUID();
  const generation = (await physical.authority!.current()).generation;
  for (const action of [
    { kind: 'begin' as const, previousEpoch: null },
    { kind: 'commit' as const },
  ])
    await people.update({ scope, epoch, action }, generation);

  // What each search asked the engine for, as list orders.
  const sent: unknown[] = [];
  const host: CacheHost = {
    ...physical,
    people: {
      ...people,
      search: (request) => {
        sent.push(request.listPriority ?? null);
        return people.search(request);
      },
    },
  };
  const read = async (query: string, ordered: boolean) => {
    const page = await readContactDirectory(
      viewer,
      host,
      {
        query,
        policy: {
          mode: 'mention',
          excluded: [viewer],
          ...(ordered ? { listPriority: MENTION_LIST_PRIORITY } : {}),
        },
      },
      new AbortController().signal,
      false
    );
    if (page.source !== 'cache') throw new Error('Window left the cache');
    return page.users.map((user) => user.name);
  };
  const browse = await read('', true);
  const typed = await read('sam 90', true);
  const unordered = await read('', false);
  output.dataset.status = 'passed';
  output.textContent = JSON.stringify({ browse, typed, unordered, sent });
} catch (error) {
  output.dataset.status = 'failed';
  output.textContent = String(error);
} finally {
  physical.dispose();
}
