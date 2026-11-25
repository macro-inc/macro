/**
 * Focus never leaves another split's field while collaborators edit a
 * document that holds every decorator type.
 *
 * One more person than the typists, the watcher, leaves a caret in the
 * document (Lexical keeps a blurred editor's selection) and moves to the
 * page's composer. Someone adds one of every rendered decorator, so each
 * mounts on the watcher's page, and then the typists run the fuzz commands:
 * typing, shortcuts, going offline, deliveries in any order. After every
 * command, and once everything is delivered, the watcher's focus must still
 * be in the composer, holding exactly what they typed there, and their region
 * of the document must be untouched.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type Route, test } from '@playwright/test';
import fc from 'fast-check';
import {
  expectComposerFocused,
  FuzzModel,
  FuzzSystem,
  watchedCommand,
} from './commands';
import { END_MARKER, markerOf, openPeers } from './harness';
import {
  MINUTES,
  PATH,
  PEERS,
  REPLAY_PATH,
  RUNS,
  SEED,
  SHRINK,
  STEPS,
} from './knobs';
import { check, type Finding, FindingsError } from './oracles';
import { Relay } from './relay';

const REPORTS = fileURLToPath(new URL('./reports/', import.meta.url));
const NAMES = 'ABCDEFGH'.slice(0, PEERS + 1).split('');
const TYPISTS = NAMES.slice(0, -1);
const WATCHER = NAMES[NAMES.length - 1];

/**
 * Kinds this test fails on. The other oracles' findings (markdown round
 * trips, console errors from decorators that reach for services the fixture
 * lacks) are reported but belong to the main fuzz test.
 */
const FOCUS_KINDS = [
  'focus',
  'composer',
  'decorators',
  'caret',
  'model',
  'no-convergence',
];

/** A 1×1 PNG for the pictures among the decorators. */
const PICTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function servePictures(page: Page) {
  await page.route(
    (url) => /\/picture-\d+\.png/.test(decodeURIComponent(url.href)),
    (route: Route) =>
      route.fulfill({
        contentType: 'image/png',
        body: PICTURE,
        headers: {
          'access-control-allow-origin':
            route.request().headers().origin ?? '*',
          'access-control-allow-credentials': 'true',
        },
      })
  );
}

/** The watcher's composer and region after everything is delivered. */
async function finalFindings(
  system: FuzzSystem,
  model: FuzzModel
): Promise<Finding[]> {
  const findings = await check(system.peers, system.relay, 'typed', (name) =>
    name === WATCHER
      ? [{ type: 'p', text: markerOf(WATCHER) }]
      : model.peer(name).blocks
  );
  const watcher = system.peer(WATCHER);
  // Writes a decorator makes after it mounts (a measured size) land late.
  await watcher.page.waitForTimeout(300);
  try {
    await expectComposerFocused(watcher, 'everything was delivered');
  } catch (error) {
    if (!(error instanceof FindingsError)) throw error;
    findings.push(...error.findings);
  }
  const composer = await watcher.page
    .getByRole('textbox', { name: 'Composer' })
    .textContent();
  if (composer !== model.composer)
    findings.push({
      kind: 'composer',
      peer: WATCHER,
      phase: 'typed',
      detail: { typed: model.composer, composer },
    });
  return findings;
}

test('focus stays in another field while collaborators edit every decorator type', async ({
  browser,
}) => {
  test.setTimeout((MINUTES + 5) * 60_000);
  let attempt = 0;
  let failing: { findings: Finding[]; commands: string } | undefined;
  const reported: Finding[] = [];

  const property = fc.asyncProperty(
    fc.scheduler(),
    fc.commands([watchedCommand(TYPISTS, WATCHER)], {
      maxCommands: STEPS,
      size: 'max',
      replayPath: REPLAY_PATH,
    }),
    async (scheduler, commands) => {
      attempt++;
      const relay = new Relay(scheduler);
      const { peers, close } = await openPeers(
        browser,
        relay,
        `focus-${attempt}`,
        NAMES.length
      );
      try {
        for (const peer of peers) await servePictures(peer.page);
        const system = new FuzzSystem(peers, relay);
        const model = new FuzzModel(NAMES);
        const watcher = system.peer(WATCHER);
        await watcher.page.getByRole('textbox', { name: 'Composer' }).click();
        const { inserted, missing } = await peers[0].api.evaluate(
          (api, marker) => api.insertEveryDecorator(marker),
          END_MARKER
        );
        const findings: Finding[] = [];
        if (missing.length > 0 || inserted.length === 0)
          findings.push({
            kind: 'decorators',
            phase: 'setup',
            detail: { inserted, missing },
          });
        try {
          await fc.asyncModelRun(() => ({ model, real: system }), commands);
        } catch (error) {
          if (!(error instanceof FindingsError)) throw error;
          findings.push(...error.findings);
        }
        findings.push(...(await finalFindings(system, model)));
        const failures = findings.filter((finding) =>
          FOCUS_KINDS.includes(finding.kind)
        );
        reported.push(
          ...findings.filter((finding) => !FOCUS_KINDS.includes(finding.kind))
        );
        if (failures.length === 0) return;
        failing = { findings: failures, commands: String(commands) };
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
  const file = `${REPORTS}focus-${details.seed}.json`;
  writeFileSync(
    file,
    JSON.stringify(
      {
        seed: details.seed,
        path: details.counterexamplePath,
        runs: details.numRuns,
        typists: TYPISTS.length,
        steps: STEPS,
        failing,
        error:
          details.errorInstance === null
            ? undefined
            : String(details.errorInstance),
        reported: [...new Set(reported.map((finding) => finding.kind))],
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
