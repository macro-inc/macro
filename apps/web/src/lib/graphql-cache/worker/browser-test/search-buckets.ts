// Real production host/WASM/OPFS. Synthetic data only: no hosted data or auth.
import { createWorkerCacheHost } from '../../host/worker-host';

const result = document.querySelector<HTMLPreElement>('#result')!;
const button = document.querySelector<HTMLButtonElement>('#search')!;
const host = createWorkerCacheHost({
  scope: `search-buckets-${crypto.randomUUID()}`,
});
const query = `query Seed($input: SoupInput!) { user { id soup(input: $input) { items { __typename id ... on GraphqlSoupDocument { name } ... on GraphqlSoupEmailThread { name } } } } }`;
const emailCount = 10_000;
const documentCount = 100;
const measurements: { buckets: string[]; ms: number; count: number }[] = [];

async function search(buckets: string[]) {
  const start = performance.now();
  const page = await host.search({
    profile: 'quick-access-v1',
    buckets,
    query: 'needle',
    limit: 20,
  });
  measurements.push({
    buckets,
    ms: performance.now() - start,
    count: page.documents.length,
  });
  return page.documents.map((document) => document.recordKey);
}

try {
  for (let offset = 0; offset < emailCount + documentCount; offset += 500) {
    const items = Array.from(
      { length: Math.min(500, emailCount + documentCount - offset) },
      (_, index) => {
        const id = index + offset;
        return {
          __typename:
            id < documentCount
              ? 'GraphqlSoupDocument'
              : 'GraphqlSoupEmailThread',
          id: `item-${id.toString().padStart(5, '0')}`,
          name: `needle ${id}`,
        };
      }
    );
    await host.writeQuery({
      query,
      variables: { input: { initial: { limit: offset + 1 } } },
      data: { user: { id: 'fixture-viewer', soup: { items } } },
    });
  }
  result.dataset.status = 'ready';
  result.textContent = `${documentCount} documents and ${emailCount} emails ready`;
  button.disabled = false;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const cold = await search(['document']);
      for (let i = 0; i < 5; i++) await search(['document']);
      const email = await search(['email']);
      const all = await search([]);
      result.textContent = JSON.stringify({ measurements, cold, email, all });
      result.dataset.status = 'passed';
    } catch (error) {
      result.textContent = String(error);
      result.dataset.status = 'failed';
    }
  });
} catch (error) {
  result.textContent = String(error);
  result.dataset.status = 'failed';
}
window.addEventListener('pagehide', () => host.dispose(), { once: true });
