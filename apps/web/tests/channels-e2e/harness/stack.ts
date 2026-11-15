import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The stack under test: the origin its proxy serves the app and the services
 * from, such as `https://localhost:8090`. Any running stack will do; the
 * suite signs its people in there and creates its own channels.
 */
export function stackUrl(): string {
  const url = process.env.CHANNELS_E2E_STACK_URL;
  if (!url) {
    throw new Error(
      'CHANNELS_E2E_STACK_URL is not set. Run the suite with `just apps/web/test-channels-e2e <instance>`.'
    );
  }
  return url.replace(/\/+$/, '');
}

/** Where this run keeps its sign-ins and what it learned about its people. */
export function runDirectory(): string {
  const directory = join(here, '..', '.run');
  mkdirSync(directory, { recursive: true });
  return directory;
}
