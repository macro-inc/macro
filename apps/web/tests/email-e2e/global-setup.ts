// Starts `email_e2e_stacks`, which starts a stack per test, unless
// EMAIL_E2E_STACKS_URL already names a running one or the tests run on the
// local stack.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { FullConfig } from '@playwright/test';
import {
  checkStandIns,
  LocalStack,
  localStackAddresses,
} from './harness/local-stack';
import { checkSignUpCounter } from './harness/sign-up-limit';
import { currentRun, runPaths, runReports } from './ledger/paths';

const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));

/** The databases a Redis hands out to stacks, with its default of 16. */
const REDIS_DATABASES = 15;

export default async function globalSetup(
  config: FullConfig
): Promise<(() => Promise<void>) | undefined> {
  // What an earlier run recorded is not this run's evidence, and neither is
  // its report: a run that ends before it writes its own would be read with
  // the results of the one before.
  const recorded = runPaths(currentRun());
  rmSync(recorded.evidence, { recursive: true, force: true });
  rmSync(recorded.playwright, { force: true });
  // A run on one machine replaces what the parts of a split run left too.
  if (!process.env.EMAIL_E2E_SHARD) {
    for (const report of runReports(currentRun()))
      rmSync(report, { force: true });
  }

  // The local stack is already running, and so is a named stack server.
  const local = localStackAddresses();
  if (local) {
    // Before anything signs up: the stack must not hold real keys.
    await checkStandIns(local);
    // Its tests each sign up a user, more of them than one address may:
    // prove the counter is where the harness clears it before they start.
    const stack = new LocalStack(local);
    await stack.user(stack.address('probe@example.com'));
    await checkSignUpCounter(local.redisUrl);
    return undefined;
  }
  if (process.env.EMAIL_E2E_STACKS_URL) return undefined;

  const binary =
    process.env.EMAIL_E2E_STACKS_BIN ??
    `${REPOSITORY}target/debug/email_e2e_stacks`;
  const server = spawn(binary, [], {
    stdio: ['ignore', 'pipe', 'inherit'],
    // The services it starts are built beside it.
    // Started stacks, one for every two workers (the server's `pool`): a
    // test takes one and the next is started while the test runs. A stack
    // starts in a fraction of the time a test takes, so half as many as
    // the workers are enough, and each holds about 40 connections of a
    // Postgres that CI gives 600. Each also leases one of Redis's
    // databases, 15 by default, which the tests' own stacks come first for.
    env: {
      EMAIL_E2E_BIN_DIR: dirname(binary),
      EMAIL_E2E_STACK_POOL: String(
        Math.max(
          0,
          Math.min(
            Math.ceil(config.workers / 2),
            REDIS_DATABASES - config.workers
          )
        )
      ),
      ...process.env,
    },
  });
  // Listened for from the start: the server may end before the run does,
  // and an exit that has happened is not told again.
  const exited = new Promise<void>((resolve) => {
    server.once('exit', () => resolve());
  });
  const url = await new Promise<string>((resolve, reject) => {
    server.once('error', reject);
    server.once('exit', (code) =>
      reject(new Error(`${binary} exited with ${code} before it listened`))
    );
    createInterface({ input: server.stdout }).once('line', resolve);
  });
  process.env.EMAIL_E2E_STACKS_URL = url;
  // The server ends the stacks it still holds before it exits: wait for it,
  // so nothing of this run is left when the next one starts.
  return async () => {
    server.kill();
    await exited;
  };
}
