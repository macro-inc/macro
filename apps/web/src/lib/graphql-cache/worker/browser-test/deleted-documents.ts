// The production document check over the real host, coordinator and
// WASM/OPFS engine. A document moved to the Trash while this client missed
// the realtime patch stays in the cache, and so in local name search, until
// the check reads it on the server. Synthetic documents only; the server
// read is a stand-in.
import {
  type ReadDocumentFromPrimary,
  removeDocumentsGoneOnPrimary,
} from '@queries/soup/graphql/document-reconcile';
import { createWorkerCacheHost } from '../../host/worker-host';

const TRASHED = '00000000-0000-7000-8000-000000000001';
const LIVE = '00000000-0000-7000-8000-000000000002';
const OTHER = '00000000-0000-7000-8000-000000000003';

const output = document.querySelector<HTMLPreElement>('#result');
if (!output) throw new Error('Missing deleted document result element');
const host = createWorkerCacheHost({
  scope: `deleted-documents-${crypto.randomUUID()}`,
});
window.addEventListener('pagehide', () => host.dispose(), { once: true });

const seed = `query Seed($input: SoupInput!) { user { id soup(input: $input) { items { __typename id ... on GraphqlSoupDocument { appearance name fileType ownerId createdAt updatedAt viewedAt subType { __typename } } } } } }`;
const documentItem = (id: string, name: string) => ({
  __typename: 'GraphqlSoupDocument',
  id,
  appearance: null,
  name,
  fileType: 'md',
  ownerId: 'macro|owner',
  createdAt: '2026-11-25T01:02:00.000Z',
  updatedAt: '2026-11-25T01:02:00.000Z',
  viewedAt: '2026-11-25T01:02:00.000Z',
  subType: null,
});

async function search(query: string) {
  const page = await host.search({
    profile: 'quick-access-v1',
    buckets: ['document', 'note'],
    query,
    limit: 20,
  });
  return page.documents.map((entry) => entry.recordKey).sort();
}

try {
  const generation = (await host.authority!.current()).generation;
  await host.writeQuery({
    generation,
    query: seed,
    variables: { input: { initial: { limit: 3 } } },
    data: {
      user: {
        id: 'fixture-viewer',
        soup: {
          items: [
            // Cached before it was renamed and trashed elsewhere.
            documentItem(TRASHED, 'Launch checklist'),
            documentItem(LIVE, 'Launch checklist'),
            documentItem(OTHER, 'Quarterly plan'),
          ],
        },
      },
    },
  });
  const beforeCheck = await search('launch');
  const reads: string[] = [];
  const read: ReadDocumentFromPrimary = async (id) => {
    reads.push(id);
    return id === TRASHED ? 'gone' : 'readable';
  };
  const check = await removeDocumentsGoneOnPrimary({
    host,
    ids: [TRASHED, LIVE],
    readFromPrimary: read,
    session: () => generation,
  });
  const afterCheck = await search('launch');
  output.textContent = JSON.stringify({
    beforeCheck,
    check,
    afterCheck,
    reads,
  });
  output.dataset.status = 'passed';
} catch (error) {
  output.textContent = String(error instanceof Error ? error.stack : error);
  output.dataset.status = 'failed';
}
