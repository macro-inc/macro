const SYNC_SERVICE_URL = 'https://sync_service.macroverse.workers.dev/schema';

import { $, write } from 'bun';

async function fetchSchema() {
  const response = await fetch(SYNC_SERVICE_URL, {
    method: 'GET',
  });

  const text = await response.text();
  await write('./generated/schema.bop', text);

  await $`npx bebopc build`;
}

await fetchSchema();
