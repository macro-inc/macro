/**
 * Several people type into one collaborative markdown document at once, each
 * in a separate browser, through the real editor and sync engine. Each person
 * types only into their own region, so a model of their keystrokes predicts
 * exactly what that region should hold; after everything is delivered every
 * copy of the document must agree and match the models.
 *
 * The keystrokes are fast-check commands and the relay's delivery order is
 * fast-check's scheduler, so a failure shrinks to a short script and replays
 * from its seed and path. See the README for the FUZZ_* knobs.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Browser, expect, type Page, test } from '@playwright/test';
import fc from 'fast-check';
import { FuzzModel, FuzzSystem, fuzzCommand } from './commands';
import { openPeers, type Peer } from './harness';
import {
  check,
  type Finding,
  FindingsError,
  STRUCTURAL_KINDS,
} from './oracles';
import { Relay } from './relay';

const number = (name: string, fallback: number) => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new Error(`${name}=${value} is not a number`);
  return parsed;
};

const RUNS = number('FUZZ_RUNS', 3);
const PEERS = number('FUZZ_PEERS', 3);
const STEPS = number('FUZZ_STEPS', 150);
const MINUTES = number('FUZZ_MINUTES', 15);
const SEED =
  process.env.FUZZ_SEED === undefined ? undefined : number('FUZZ_SEED', 0);
const PATH = process.env.FUZZ_PATH;
const REPLAY_PATH = process.env.FUZZ_REPLAY_PATH;
const SHRINK = process.env.FUZZ_SHRINK !== '0';
/** Undo everything everyone did, check, then redo it all and check again. */
const UNDO = process.env.FUZZ_UNDO;
/** Finding kinds that go in the report without failing the run. */
const IGNORE = new Set(process.env.FUZZ_IGNORE?.split(',').filter(Boolean));
const REPORTS = fileURLToPath(new URL('./reports/', import.meta.url));

const NAMES = 'ABCDEFGH'.slice(0, PEERS).split('');

/** What one run found, and the input that found it. */
type Run = { findings: Finding[]; commands: string; scheduler: string };

/** Presses `key` up to `budget(name)` times per person, delivering one message after each. */
async function pressAll(
  peers: Peer[],
  relay: Relay,
  key: string,
  budget: (name: string) => number,
  sequential: boolean
): Promise<void> {
  // Slower than history's merge window, so each press is its own step.
  const pressOnce = async (page: Page) => {
    await page.keyboard.press(key, { delay: 5 });
    await relay.deliver(1);
  };
  if (sequential) {
    for (const peer of peers)
      for (let i = 0; i < budget(peer.name); i++) await pressOnce(peer.page);
    return;
  }
  const rounds = Math.max(...peers.map((peer) => budget(peer.name)));
  for (let round = 0; round < rounds; round++)
    for (const peer of peers)
      if (round < budget(peer.name)) await pressOnce(peer.page);
}

/**
 * Opens the peers on a fresh relay, once more if their pages don't load: on a
 * busy machine a page can miss its load timeout, which says nothing about the
 * editor and must not become the counterexample fast-check shrinks.
 */
async function openRun(
  browser: Browser,
  scheduler: fc.Scheduler,
  documentId: string
): Promise<{ relay: Relay; peers: Peer[]; close: () => Promise<void> }> {
  const open = async (id: string) => {
    const relay = new Relay(scheduler);
    return { relay, ...(await openPeers(browser, relay, id, PEERS)) };
  };
  try {
    return await open(documentId);
  } catch (error) {
    console.warn(`peers did not open (${String(error)}); retrying once`);
    return open(`${documentId}-retry`);
  }
}

/** The typing phase's findings, then undo-all and redo-all's when FUZZ_UNDO is set. */
async function phases(
  peers: Peer[],
  relay: Relay,
  model: FuzzModel,
  commands: Iterable<fc.AsyncCommand<FuzzModel, FuzzSystem>>
): Promise<Finding[]> {
  const findings: Finding[] = [];
  try {
    await fc.asyncModelRun(
      () => ({ model, real: new FuzzSystem(peers, relay) }),
      commands
    );
  } catch (error) {
    if (!(error instanceof FindingsError)) throw error;
    findings.push(...error.findings);
  }
  const typed = (name: string) => model.peer(name).blocks;
  findings.push(...(await check(peers, relay, 'typed', typed)));
  if (
    !UNDO ||
    findings.some((finding) => STRUCTURAL_KINDS.includes(finding.kind))
  )
    return findings;
  // Loro's undo is per person: undoing everything you did leaves only the
  // seed, whatever the others did; redoing it all brings it back.
  const budget = (name: string) => 3 * model.peer(name).keys;
  await pressAll(peers, relay, 'Control+z', budget, UNDO === 'sequential');
  findings.push(
    ...(await check(peers, relay, 'undone', (name) => [
      { type: 'p', text: model.peer(name).marker },
    ]))
  );
  await pressAll(peers, relay, 'Control+Shift+z', budget, false);
  findings.push(...(await check(peers, relay, 'redone', typed)));
  return findings;
}

test('peers typing into one document agree with each other and their models', async ({
  browser,
}) => {
  test.setTimeout((MINUTES + 5) * 60_000);
  let attempt = 0;
  let failing: Run | undefined;
  const ignored: Finding[] = [];

  const property = fc.asyncProperty(
    fc.scheduler(),
    fc.commands([fuzzCommand(NAMES)], {
      maxCommands: STEPS,
      size: 'max',
      replayPath: REPLAY_PATH,
    }),
    async (scheduler, commands) => {
      attempt++;
      const { relay, peers, close } = await openRun(
        browser,
        scheduler,
        `fuzz-${attempt}`
      );
      try {
        const model = new FuzzModel(NAMES);
        const findings = await phases(peers, relay, model, commands);
        ignored.push(...findings.filter((finding) => IGNORE.has(finding.kind)));
        const failures = findings.filter(
          (finding) => !IGNORE.has(finding.kind)
        );
        if (failures.length === 0) return;
        failing = {
          findings: failures,
          commands: String(commands),
          scheduler: String(scheduler),
        };
        throw new FindingsError(failures);
      } finally {
        await close();
      }
    }
  );

  const details = await fc.check(property, {
    seed: SEED,
    path: PATH,
    numRuns: RUNS,
    endOnFailure: !SHRINK,
    interruptAfterTimeLimit: MINUTES * 60_000,
  });

  mkdirSync(REPORTS, { recursive: true });
  const file = `${REPORTS}fuzz-${details.seed}.json`;
  writeFileSync(
    file,
    JSON.stringify(
      {
        seed: details.seed,
        path: details.counterexamplePath,
        runs: details.numRuns,
        shrinks: details.numShrinks,
        peers: PEERS,
        steps: STEPS,
        // The smallest failing run fast-check found: its commands, the
        // scheduler's delivery order, and what the oracles saw.
        failing,
        error:
          details.errorInstance === null
            ? undefined
            : String(details.errorInstance),
        ignored: [...new Set(ignored.map((finding) => finding.kind))],
      },
      null,
      2
    )
  );
  expect(
    details.failed,
    `${fc.defaultReportMessage(details) ?? ''}\nreport: ${file}`
  ).toBe(false);
});
