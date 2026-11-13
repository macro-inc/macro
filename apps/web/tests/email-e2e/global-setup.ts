// Starts `email_e2e_stacks`, which starts a stack per test, unless
// EMAIL_E2E_STACKS_URL already names a running one.

import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));

export default async function globalSetup(): Promise<(() => void) | undefined> {
  if (process.env.EMAIL_E2E_STACKS_URL) return undefined;

  const binary =
    process.env.EMAIL_E2E_STACKS_BIN ?? `${REPOSITORY}target/debug/email_e2e_stacks`;
  const server = spawn(binary, [], {
    stdio: ['ignore', 'pipe', 'inherit'],
    // The services it starts are built beside it.
    env: { EMAIL_E2E_BIN_DIR: dirname(binary), ...process.env },
  });
  const url = await new Promise<string>((resolve, reject) => {
    server.once('error', reject);
    server.once('exit', (code) =>
      reject(new Error(`${binary} exited with ${code} before it listened`))
    );
    createInterface({ input: server.stdout }).once('line', resolve);
  });
  process.env.EMAIL_E2E_STACKS_URL = url;
  return () => {
    server.kill();
  };
}
