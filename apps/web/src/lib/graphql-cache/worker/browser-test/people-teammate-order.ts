// The production directory reader over the real app host wrapper, coordinator
// and WASM/OPFS engine, beside the server path a tab without the cache reads,
// for one set of synthetic people: with and without a mention list order, the
// cache lists them as the tab without it does.
import { contactRecordKey } from '@queries/contacts/contact-key';
import {
  type ContactDirectoryRequest,
  readContactDirectory,
} from '@queries/contacts/directory';
import { MENTION_LIST_PRIORITY } from '@queries/contacts/list-priority';
import { orderServerPage } from '@queries/contacts/server-page-order';
import { createRetirableCacheHost } from '../../host/retirable-host';
import type { CacheHost } from '../../host/types';
import { createWorkerCacheHost } from '../../host/worker-host';
import { captureContactWriteScope } from '../../people/sync';
import { answerServerReads } from './people-list-order-adapters';

const VIEWER = 'macro|viewer@example.com';
/** Name, address and lists; the direct-message partner and the teammates are
 * marked below. Ids sort as the server pages them. */
const PEOPLE = [
  ['Jacoby Chat', 'jacoby.chat', ['interacted']],
  ['Jacob Rivers', 'jacob.rivers', ['teammates']],
  ['Jacobson Mate', 'jacobson.mate', ['teammates']],
  ['Jacob', 'jacob.a', ['gmail']],
  ['Jacob', 'jacob.b', []],
  ['Jacobi Stranger', 'jacobi.stranger', []],
  ['Bjacob', 'bjacob', ['gmail']],
] as const;
const userId = (address: string) => `macro|${address}@example.com`;
const DM_PARTNER = userId('jacoby.chat');
const ROSTER = [userId('jacob.rivers'), userId('jacobson.mate'), VIEWER].sort();

const nodes = PEOPLE.map(([name, address, lists]) => ({
  __typename: 'GraphqlContact' as const,
  id: contactRecordKey(VIEWER, userId(address)).slice('GraphqlContact:'.length),
  userId: userId(address),
  email: `${address}@example.com`,
  name,
  lists: [...lists],
})).sort((a, b) => a.userId.localeCompare(b.userId));
const page = (found: typeof nodes) => ({
  user: { id: VIEWER, contacts: { nodes: found, nextCursor: null } },
});
answerServerReads({
  fetchContactDirectoryPage: async ({ search }) =>
    page(
      nodes.filter((node) =>
        node.name.toLowerCase().includes((search ?? '').toLowerCase())
      )
    ),
  fetchContactReferencePage: async ({ search }) =>
    page(
      nodes.filter((node) => {
        const name = node.name.toLowerCase();
        const query = (search ?? '').toLowerCase();
        return name === query || name.split(' ')[0] === query;
      })
    ),
  fetchContactDirectoryByIds: async (ids) => ({
    user: {
      id: VIEWER,
      contactsByUserIds: nodes.filter((node) => ids.includes(node.userId)),
    },
  }),
});

const output = document.querySelector<HTMLPreElement>('#result');
if (!output) throw new Error('Missing teammate order result element');
const physical = createRetirableCacheHost(
  createWorkerCacheHost({
    scope: `people-teammate-order-${crypto.randomUUID()}`,
  })
);
window.addEventListener('pagehide', () => physical.dispose(), { once: true });
try {
  const scope = {
    identity: VIEWER,
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
    data: page(nodes),
    identity: VIEWER,
    hydrationScope: guarded,
  });

  // The direct-message context the frontend publishes: one partner.
  const epoch = crypto.randomUUID();
  const generation = (await physical.authority!.current()).generation;
  for (const action of [
    { kind: 'begin' as const, previousEpoch: null },
    {
      kind: 'patch' as const,
      updates: [
        {
          userId: DM_PARTNER,
          facts: {
            lastInteractionMs: 2000,
            directMessage: null,
            secondaryInbox: false,
          },
        },
      ],
    },
    { kind: 'commit' as const },
  ])
    await people.update({ scope, epoch, action }, generation);

  // Which policy-8 and policy-7 fields each search carried.
  const sent: { teammates: boolean; lists: boolean }[] = [];
  const host: CacheHost = {
    ...physical,
    people: {
      ...people,
      search: (request) => {
        sent.push({
          teammates: !!request.teammates?.length,
          lists: !!request.listPriority?.length,
        });
        return people.search(request);
      },
    },
  };
  const request = (lists: boolean): ContactDirectoryRequest => ({
    query: 'jacob',
    policy: {
      mode: 'mention',
      excluded: [VIEWER],
      ...(lists ? { listPriority: MENTION_LIST_PRIORITY } : {}),
    },
    teammates: ROSTER,
  });
  const cached = async (lists: boolean) => {
    const window = await readContactDirectory(
      VIEWER,
      host,
      request(lists),
      new AbortController().signal,
      false
    );
    if (window.source !== 'cache') throw new Error('Window left the cache');
    return window.users.map((user) => user.email);
  };
  const withoutLists = await cached(false);
  const withLists = await cached(true);

  const serverPage = await readContactDirectory(
    VIEWER,
    undefined,
    request(false),
    new AbortController().signal,
    true
  );
  if (serverPage.source !== 'server' || !serverPage.named)
    throw new Error('Expected a typed server page');
  const cacheless = orderServerPage(serverPage.users, serverPage.named, {
    directMessages: new Map([[DM_PARTNER, new Date(2000)]]),
    teammates: new Set(ROSTER),
  }).map((user) => user.email);

  output.dataset.status = 'passed';
  output.textContent = JSON.stringify({
    withoutLists,
    withLists,
    cacheless,
    sent,
  });
} catch (error) {
  output.dataset.status = 'failed';
  output.textContent = String(error);
} finally {
  physical.dispose();
}
