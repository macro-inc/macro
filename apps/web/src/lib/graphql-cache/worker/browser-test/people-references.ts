// Real app host wrapper, coordinator and WASM/OPFS. Only server data is synthetic.
import { contactRecordKey } from '@queries/contacts/contact-key';
import { createRetirableCacheHost } from '../../host/retirable-host';
import { createWorkerCacheHost } from '../../host/worker-host';
import type { PeopleReferenceRequest } from '../../people/protocol';
import { captureContactWriteScope } from '../../people/sync';

const output = document.querySelector<HTMLPreElement>('#result');
if (!output) throw new Error('Missing reference result element');
const host = createRetirableCacheHost(
  createWorkerCacheHost({ scope: `people-references-${crypto.randomUUID()}` })
);
window.addEventListener('pagehide', () => host.dispose(), { once: true });
try {
  const viewer = 'macro|viewer@example.com';
  const scope = {
    identity: viewer,
    storageGeneration: await host.currentStorageGeneration(),
  };
  const people = host.people;
  if (!people) throw new Error('Missing person capability through app wrapper');
  const guarded = await captureContactWriteScope(
    host,
    scope,
    new AbortController().signal
  );
  if (!guarded) throw new Error('Missing contact admission');
  await host.hydrateQuery({
    query:
      '{ user { id contacts(limit: 2) { nodes { __typename id userId name email } nextCursor } } }',
    data: {
      user: {
        id: viewer,
        contacts: {
          nodes: ['one', 'two'].map((name) => ({
            __typename: 'GraphqlContact',
            id: contactRecordKey(viewer, `macro|${name}@example.com`).slice(
              'GraphqlContact:'.length
            ),
            userId: `macro|${name}@example.com`,
            email: `${name}@example.com`,
            name: `Sam ${name}`,
          })),
          nextCursor: null,
        },
      },
    },
    identity: viewer,
    hydrationScope: guarded,
  });
  const before = await host.currentRevision();
  const request: PeopleReferenceRequest = {
    scope,
    labels: ['Sam', 'Sam one', 'missing'],
    matching: 'preferFullName',
    excludeSecondaryInboxes: false,
  };
  const result = await people.resolveReferences(request);
  if (result.kind !== 'resolved')
    throw new Error('Reference capability was not routed to the engine');
  if (result.matches.map((entry) => entry.people.length).join(',') !== '2,1,0')
    throw new Error('Reference evidence was lost or truncated');
  if (result.matches.some((entry) => !entry.complete))
    throw new Error('Scoped fixture was incomplete');
  if ((await host.currentRevision()) !== before)
    throw new Error('Reference read advanced revision');
  let foreignRejected = false;
  try {
    await people.resolveReferences({
      ...request,
      scope: { ...scope, identity: 'macro|other@example.com' },
    });
  } catch {
    foreignRejected = true;
  }
  if (!foreignRejected) throw new Error('Foreign viewer was admitted');
  await host.clear();
  let staleRejected = false;
  try {
    await people.resolveReferences(request);
  } catch {
    staleRejected = true;
  }
  if (!staleRejected) throw new Error('Stale generation was admitted');
  const read = people.resolveReferences;
  host.dispose();
  if ((await read(request)).kind !== 'unsupported')
    throw new Error('Captured reference survived host retirement');
  output.dataset.status = 'passed';
  output.textContent = JSON.stringify({
    witnesses: [2, 1, 0],
    foreignRejected,
    staleRejected,
  });
} catch (error) {
  host.dispose();
  output.dataset.status = 'failed';
  output.textContent = String(error);
}
