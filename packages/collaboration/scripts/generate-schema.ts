const SYNC_SERVICE_URL = 'https://sync_service.macroverse.workers.dev/schema';

import { resolve } from 'node:path';
import { $, write } from 'bun';

const packageRoot = resolve(import.meta.dir, '..');

async function fetchSchema() {
  const response = await fetch(SYNC_SERVICE_URL, {
    method: 'GET',
  });

  const text = await response.text();
  await write(
    resolve(packageRoot, 'src/sync-service/generated/schema.bop'),
    text
  );

  await $`bunx bebopc build`.cwd(packageRoot);
}

await fetchSchema();
