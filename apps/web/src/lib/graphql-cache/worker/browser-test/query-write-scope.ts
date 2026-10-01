// Production host + WASM/OPFS, with synthetic responses only. No auth or hosted
// data is required. Exercise the same scoped subscriber used by Quick Access.
import { subscribeToVisibleCacheChanges } from '@queries/subscribe-to-visible-cache-changes';
import { createRoot } from 'solid-js';
import { createWorkerCacheHost } from '../../host/worker-host';

const result = document.querySelector<HTMLPreElement>('#result')!;
const pageButton = document.querySelector<HTMLButtonElement>('#page')!;
const renameButton = document.querySelector<HTMLButtonElement>('#rename')!;
const host = createWorkerCacheHost({
  scope: `query-write-scope-${crypto.randomUUID()}`,
});
const query = `query Page($input: SoupInput!) { user { id soup(input: $input) { items { __typename id ... on GraphqlSoupDocument { name fileType } } } } }`;
const variables = (limit: number) => ({ input: { initial: { limit } } });
const data = (name: string) => ({
  user: {
    id: 'fixture-viewer',
    soup: {
      items: [
        {
          __typename: 'GraphqlSoupDocument',
          id: 'fixture-doc',
          name,
          fileType: 'md',
        },
      ],
    },
  },
});
const affected: number[][] = [];
const names = new Map<number, string>();
let searchRefreshes = 0;
let dispose = () => {};

function display(status: string) {
  result.dataset.status = status;
  result.textContent = JSON.stringify({
    affected,
    searchRefreshes,
    names: [...names.values()],
  });
}
async function read(opKey: number) {
  const response = await host.readQuery({
    opKey,
    query,
    variables: variables(opKey),
  });
  if (response.kind !== 'hit') throw new Error(`page ${opKey} missed`);
  const value = response.data as ReturnType<typeof data>;
  names.set(opKey, value.user.soup.items[0].name);
}
async function write(limit: number, name: string) {
  await host.writeQuery({
    query,
    variables: variables(limit),
    data: data(name),
  });
}
async function run(limit: number, name: string) {
  pageButton.disabled = renameButton.disabled = true;
  try {
    await write(limit, name);
    // Push callbacks are delivered before the write response. Re-read just the
    // operations the host invalidated, as the exchange would, not every page.
    for (const key of new Set(affected.flat())) await read(key);
    display('passed');
  } catch (error) {
    result.dataset.status = 'failed';
    result.textContent = String(error);
  } finally {
    pageButton.disabled = renameButton.disabled = false;
  }
}
try {
  await write(1, 'Original');
  await write(2, 'Original');
  await read(1);
  await read(2);
  host.onOpsAffected((keys) => affected.push(keys));
  createRoot((cleanup) => {
    const unsubscribe = subscribeToVisibleCacheChanges(
      host,
      () => {
        searchRefreshes++;
      },
      { searchBuckets: () => ['note'] }
    );
    dispose = () => {
      unsubscribe();
      cleanup();
    };
  });
  pageButton.addEventListener('click', () => void run(3, 'Original'));
  renameButton.addEventListener('click', () => void run(3, 'Renamed'));
  pageButton.disabled = renameButton.disabled = false;
  display('ready');
} catch (error) {
  result.dataset.status = 'failed';
  result.textContent = String(error);
}
window.addEventListener(
  'pagehide',
  () => {
    dispose();
    host.dispose();
  },
  { once: true }
);
