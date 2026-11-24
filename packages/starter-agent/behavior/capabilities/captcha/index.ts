/**
 * Clearing a human check (a CAPTCHA) on your own browser's current tab:
 * `solveCaptcha` hands it to a solver, then tells you what the page did.
 */
import { mkdir, readFile, rm } from 'node:fs/promises';
import { behavior } from '@macro-inc/muppet/core/behavior';
import { module } from '@macro-inc/muppet/core/capability';
import {
  agentTelemetryId,
  telemetryEnvironment,
} from '../../context/telemetry.ts';
import { endRun, startRun } from './brain.ts';
import type { CaptchaContext } from './context.ts';
import type { Recorded } from './mcp.ts';
import { openCodeArgv, openCodeEnvironment } from './opencode.ts';
import { findChallenge, type Outcome } from './solve.ts';

type Needs = Pick<
  CaptchaContext,
  'captcha' | 'shell' | 'sandbox' | 'join' | 'relay' | 'macro' | 'trace'
> & { readonly config: Pick<CaptchaContext['config'], 'me'> };

export type SolveCaptchaResult =
  | Outcome
  /** Your owner is driving your screen; it's theirs until they hand it back. */
  | { readonly outcome: 'ownerDriving' }
  /** Another solve holds your browser. */
  | { readonly outcome: 'busy' }
  /** The solver ran but never solved (it stopped, or ran out of time). */
  | { readonly outcome: 'solverFailed'; readonly exitCode: number }
  /** Your browser has no window or tab to look at. */
  | { readonly outcome: 'browserUnavailable' };

/** What to do next, for each outcome, with your owner's screen link when it's theirs to do. */
export type Answer = SolveCaptchaResult & {
  readonly next: string;
  /** Your screen in Macro, for your owner to take over, when known. */
  readonly screen?: string;
};

const readOrMissing = (path: string): Promise<string | undefined> =>
  readFile(path, 'utf8').catch(() => undefined);

/** Your owner's link to take over your screen, if the harness has said which computer this is. */
const screenLink = async (needs: Needs): Promise<string | undefined> => {
  const harness = (
    await readOrMissing(needs.captcha.config.harnessIdFile)
  )?.trim();
  if (harness === undefined || !/^[0-9a-f-]{36}$/i.test(harness))
    return undefined;
  const origin = (await needs.macro()).webAppUrl.replace(/\/+$/, '');
  return `${origin}/app/screen/${harness}?mode=drive`;
};

const askOwner =
  'Ask your owner to clear it on your screen (send them the screen link if there is one), or find another way: an API, an integration, or a login they grant you.';

const nextStep = (result: SolveCaptchaResult): string => {
  const outcome = result.outcome;
  if (outcome === 'solved') return 'Cleared. Carry on with the page.';
  if (outcome === 'injected')
    return "The token is in the form, but the page hasn't reacted: submit the form, then check the page.";
  if (outcome === 'noChallenge') return 'No human check on this tab.';
  if (outcome === 'ownerDriving')
    return 'Your owner is driving your screen. Wait until they hand it back.';
  if (outcome === 'busy') return 'Another solve is running. Wait for it.';
  if (outcome === 'browserUnavailable')
    return 'Your browser has no window or tab open: open the page in it, then try again.';
  if (outcome === 'pageChanged')
    return 'The tab moved on during the solve. Look at the page and try again if the check is still there.';
  if (result.outcome === 'budgetExceeded')
    return `Solving is paused for now (the ${result.limit} limit). ${askOwner}`;
  return askOwner;
};

/** How long past its own limit a run may take before it is killed from outside. */
const backstopMs = 30_000;

/** The attempts the MCP server recorded, in order; a line a killed run cut short is skipped. */
const recorded = (text: string | undefined): readonly Recorded[] =>
  (text ?? '')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Recorded];
      } catch {
        return [];
      }
    });

/**
 * The attempt to report: a solved one stands (a later attempt can only find
 * the check gone); otherwise the last one, which says what the page is like
 * now (an earlier `injected` is stale once the owner took over or the page
 * moved on).
 */
export const bestOutcome = (
  attempts: readonly Recorded[]
): Outcome | undefined =>
  attempts.find(({ outcome }) => outcome.outcome === 'solved')?.outcome ??
  attempts.at(-1)?.outcome;

/** One OpenCode run under the harness's solver run, its files in a directory of its own that is removed after. */
const runSolver = (needs: Needs, runId: string): Promise<SolveCaptchaResult> =>
  needs.trace('captcha.opencode_run', async (span) => {
    span.set('captcha.run_id', runId);
    const { config } = needs.captcha;
    const home = needs.join(config.runs, runId);
    const record = needs.join(home, 'record.jsonl');
    await mkdir(home, { recursive: true });
    try {
      const relay = await needs.relay();
      const place = {
        relay,
        browser: needs.captcha.browserEndpoint,
        runId,
        server: config.server,
        record,
        screenDriver: needs.captcha.screenDriver,
        bun: process.execPath,
        traceparent: span.traceparent(),
        telemetry: {
          agentId: agentTelemetryId(needs.config.me),
          environment: telemetryEnvironment(process.env),
        },
      };
      // `timeout` inside the sandbox stops the run at the limit; this one only backs it up.
      const ran = await needs.shell.run(
        [...needs.sandbox, ...openCodeArgv(config.runLimitMs)],
        {
          cwd: home,
          env: openCodeEnvironment(place, home, needs.join),
          timeoutMs: config.runLimitMs + backstopMs,
        }
      );
      span.set('captcha.opencode_exit', ran.code);
      const attempts = recorded(await readOrMissing(record));
      span.set('captcha.attempts', attempts.length);
      const outcome = bestOutcome(attempts);
      return outcome ?? { outcome: 'solverFailed', exitCode: ran.code };
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

/**
 * Clears the human check (CAPTCHA) on your browser's current tab: reCAPTCHA
 * v2 or v3, or Cloudflare Turnstile. A solver solves it and puts the answer
 * in the page; the outcome is what the page did after, so read `next`.
 * Anything else (a Cloudflare "Just a moment…" page, hCaptcha, DataDome,
 * picture puzzles) comes back `unsupported`: then ask your owner, with the
 * `screen` link when there is one. `reason` says what you were doing, for
 * the log. Your browser is the solver's until it returns, up to five
 * minutes.
 */
export const solveCaptcha = (
  needs: Needs,
  { reason }: { readonly reason: string }
): Promise<Answer> =>
  needs.trace('captcha.solve_captcha', async (span) => {
    span.set('captcha.reason_length', reason.length);
    const answer = async (result: SolveCaptchaResult): Promise<Answer> => {
      span.set('captcha.outcome', result.outcome);
      const next = nextStep(result);
      const screen =
        result.outcome === 'solved' || result.outcome === 'noChallenge'
          ? undefined
          : await screenLink(needs);
      return { ...result, next, ...(screen === undefined ? {} : { screen }) };
    };

    const driver = await needs.captcha.driving.driver();
    if (driver.kind === 'owner') return answer({ outcome: 'ownerDriving' });
    if (driver.kind === 'solver') return answer({ outcome: 'busy' });

    // Nothing to solve, or nothing the solver takes: say so without starting it.
    let found: Awaited<ReturnType<typeof findChallenge>>;
    try {
      found = await needs.trace('captcha.find', () =>
        needs.captcha.withPage(findChallenge)
      );
    } catch {
      return answer({ outcome: 'browserUnavailable' });
    }
    if (!('challenge' in found)) return answer(found);
    span.set('captcha.kind', found.challenge.kind);

    const leaseId = crypto.randomUUID();
    if (!(await needs.captcha.driving.acquire(leaseId)))
      return answer({ outcome: 'busy' });
    try {
      // The harness admits the run (one at a time, per-agent caps) and binds every model call and solve to it.
      const run = await needs.trace('captcha.start_run', async () =>
        startRun({ relay: await needs.relay(), fetch: needs.captcha.fetch })
      );
      if (run.outcome !== 'started') return await answer(run);
      try {
        return await answer(await runSolver(needs, run.runId));
      } finally {
        // A failure to end it only delays the next run until the run expires.
        await needs.trace('captcha.end_run', async () =>
          endRun(
            { relay: await needs.relay(), fetch: needs.captcha.fetch },
            run.runId
          )
        );
      }
    } finally {
      await needs.captcha.driving.release(leaseId);
    }
  });

export const captchaModule = module({
  name: 'captcha',
  summary:
    'Clear a human check (CAPTCHA) on your browser’s current tab, or learn it is one for your owner.',
  docs: `When a page in your browser shows a human check ("I'm not a robot", a Cloudflare Turnstile box), call solveCaptcha with what you were doing. Read its \`next\` and do that. Never click, solve or script a check yourself, and never work around one another way (another browser, a different user agent, a proxy).

Use it only for what your owner asked of you. Never to make accounts in bulk, buy tickets automatically, or collect data that isn't public.

Outcomes: solved (carry on); injected (submit the form); noChallenge; unsupported, unsolvable, timeout, vendorError, budgetExceeded, notConfigured, refused, solverFailed, stillChallenged (ask your owner to clear it on your screen: send them \`screen\` when it is there); ownerDriving and busy (wait); browserUnavailable (open the page first).`,
  file: import.meta.path,
  functions: { solveCaptcha },
});

export const captchaCapabilities =
  behavior<CaptchaContext>().capability(captchaModule);
