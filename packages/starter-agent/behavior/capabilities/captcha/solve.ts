/**
 * One solve on the current tab, start to finish, and what the page did:
 * detect the challenge, have the harness solve it, put the token in the page,
 * then look again. The outcome is what was observed, never what was hoped.
 */
import type { Trace } from '../../agent/claude.ts';
import { hostOf } from '../browser/browse.ts';
import { type Refused, requestSolve, type SolveResult } from './brain.ts';
import {
  type Challenge,
  type Detection,
  detect,
  solvePageUrl,
  type UnsupportedProvider,
} from './detect.ts';
import {
  injectToken,
  type Page,
  readFacts,
  settle,
  targetIdOf,
} from './page.ts';

/**
 * How the page shows a token took: it moved to another page, or the
 * challenge is gone from this one. The widget's callback running is not
 * evidence: the solver runs it itself.
 */
export type Evidence = 'navigated' | 'challengeGone';

export type Outcome =
  | { readonly outcome: 'solved'; readonly evidence: Evidence }
  /** The token is in the widget's field (and its callback ran, if it names one), but the challenge is still shown: submit the form. */
  | { readonly outcome: 'injected' }
  /** The owner took over the screen during the solve: the solver stopped. */
  | { readonly outcome: 'ownerDriving' }
  /** The token couldn't be placed, or the page showed the challenge again. */
  | { readonly outcome: 'stillChallenged' }
  | { readonly outcome: 'noChallenge' }
  | {
      readonly outcome: 'unsupported';
      readonly provider: UnsupportedProvider;
    }
  /** The tab went elsewhere while the harness was solving. */
  | { readonly outcome: 'pageChanged' }
  | Exclude<SolveResult, { readonly outcome: 'solved' }>
  | Refused;

export type SolveNeeds = {
  /** Runs `use` on the agent's current tab. */
  readonly withPage: <Value>(
    use: (page: Page) => Promise<Value>
  ) => Promise<Value>;
  /** Runs `use` on the tab with this DevTools target id; undefined when it is gone. */
  readonly withTarget: <Value>(
    targetId: string,
    use: (page: Page) => Promise<Value>
  ) => Promise<Value | undefined>;
  readonly relay: { readonly url: string; readonly token: string };
  readonly fetch: (request: Request) => Promise<Response>;
  readonly trace: Trace;
  /** Whether the owner has taken over the screen; checked before each step that touches the page. */
  readonly ownerDriving: () => Promise<boolean>;
};

type Found = {
  /** The tab the challenge is on: the token goes to it, not to whichever tab is newest by then. */
  readonly targetId: string;
  readonly url: string;
  readonly pageUrl: string;
  readonly challenge: Challenge;
  readonly callback?: string;
};

const sameChallenge = (detection: Detection, found: Found): boolean =>
  detection.kind === 'supported' &&
  detection.challenge.kind === found.challenge.kind &&
  detection.challenge.siteKey === found.challenge.siteKey;

/** Detects the challenge on the current tab, if any, without touching it. */
export const findChallenge = async (
  page: Page
): Promise<Found | Exclude<Outcome, { outcome: 'solved' }>> => {
  const detection = detect(await readFacts(page));
  if (detection.kind === 'none') return { outcome: 'noChallenge' };
  if (detection.kind === 'unsupported')
    return { outcome: 'unsupported', provider: detection.provider };
  const pageUrl = solvePageUrl(page.url());
  if (pageUrl === undefined) return { outcome: 'noChallenge' };
  return {
    targetId: await targetIdOf(page),
    url: page.url(),
    pageUrl,
    challenge: detection.challenge,
    ...(detection.callback === undefined
      ? {}
      : { callback: detection.callback }),
  };
};

const isFound = (value: Found | Outcome): value is Found =>
  'challenge' in value;

/** A page that navigated mid-evaluate throws; that is the page moving on, not a failure. */
const contextDestroyed = (error: unknown): boolean =>
  error instanceof Error &&
  /context was destroyed|navigat/i.test(error.message);

/**
 * Puts the token in, waits for the page, and says what it saw. "Navigated"
 * is a change of origin or path from right before the token went in, so a
 * hash or query change during the solve doesn't count.
 */
const apply = async (
  page: Page,
  found: Found,
  token: string,
  ownerDriving: () => Promise<boolean>
): Promise<Outcome> => {
  const before = page.url();
  if (solvePageUrl(before) !== found.pageUrl) return { outcome: 'pageChanged' };
  // The page may have swapped its widget while the harness solved: the token is for the old one.
  if (!sameChallenge(detect(await readFacts(page)), found))
    return { outcome: 'pageChanged' };
  // Checked again on the tab itself: the owner may have taken over while we attached.
  if (await ownerDriving()) return { outcome: 'ownerDriving' };
  const moved = () => solvePageUrl(page.url()) !== found.pageUrl;

  let injected: Awaited<ReturnType<typeof injectToken>> | undefined;
  try {
    injected = await injectToken(page, {
      challenge: found.challenge,
      token,
      ...(found.callback === undefined ? {} : { callback: found.callback }),
    });
  } catch (error) {
    if (!contextDestroyed(error)) throw error;
  }
  await settle(page, before);

  let after: Detection;
  try {
    after = detect(await readFacts(page));
  } catch (error) {
    if (!contextDestroyed(error)) throw error;
    await settle(page, page.url());
    after = detect(await readFacts(page));
  }
  if (moved() && after.kind === 'none')
    return { outcome: 'solved', evidence: 'navigated' };
  if (after.kind === 'none')
    return { outcome: 'solved', evidence: 'challengeGone' };
  if (
    !moved() &&
    sameChallenge(after, found) &&
    injected !== undefined &&
    (injected.filled > 0 ||
      injected.executeAnswered ||
      injected.callback === 'ran')
  )
    return { outcome: 'injected' };
  return { outcome: 'stillChallenged' };
};

/**
 * The whole solve. The tab is let go while the harness solves (up to two
 * minutes) and taken again to apply the token, after checking it is still on
 * the page the challenge was on.
 */
export const solveOnPage = (
  needs: SolveNeeds,
  { solveId, runId }: { readonly solveId: string; readonly runId: string }
): Promise<Outcome> =>
  needs.trace('captcha.solve', async (span) => {
    if (await needs.ownerDriving()) {
      span.set('captcha.outcome', 'ownerDriving');
      return { outcome: 'ownerDriving' };
    }
    const found = await needs.trace('captcha.find', () =>
      needs.withPage(findChallenge)
    );
    if (!isFound(found)) {
      span.set('captcha.outcome', found.outcome);
      return found;
    }
    span.set('captcha.kind', found.challenge.kind);
    span.set('captcha.solve_id', solveId);
    span.set('browser.host', hostOf(found.url));

    // The harness polls CapSolver for up to two minutes: its own span, joined by the harness's.
    const solved = await needs.trace('captcha.harness_solve', async (call) => {
      const result = await requestSolve(needs, {
        runId,
        solveId,
        pageUrl: found.pageUrl,
        challenge: found.challenge,
        traceparent: call.traceparent(),
      });
      call.set('captcha.outcome', result.outcome);
      return result;
    });
    if (solved.outcome !== 'solved') {
      span.set('captcha.outcome', solved.outcome);
      return solved;
    }
    span.set('captcha.task_id', solved.taskId);

    // The owner may have taken over while the harness was solving: their screen, not ours.
    if (await needs.ownerDriving()) {
      span.set('captcha.outcome', 'ownerDriving');
      return { outcome: 'ownerDriving' };
    }
    const outcome =
      (await needs.trace('captcha.apply', () =>
        needs.withTarget(found.targetId, (page) =>
          apply(page, found, solved.token, needs.ownerDriving)
        )
      )) ?? ({ outcome: 'pageChanged' } as const);
    span.set('captcha.outcome', outcome.outcome);
    if (outcome.outcome === 'solved')
      span.set('captcha.evidence', outcome.evidence);
    return outcome;
  });
