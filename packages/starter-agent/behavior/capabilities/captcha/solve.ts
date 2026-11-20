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
import { injectToken, type Page, readFacts, settle } from './page.ts';

/** How the page shows a token took. */
export type Evidence = 'navigated' | 'challengeGone' | 'callbackRan';

export type Outcome =
  | { readonly outcome: 'solved'; readonly evidence: Evidence }
  /** The token is in the widget's field, but nothing on the page reacted yet: submit the form. */
  | { readonly outcome: 'injected' }
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
  readonly withPage: <Value>(use: (page: Page) => Promise<Value>) => Promise<Value>;
  readonly relay: { readonly url: string; readonly token: string };
  readonly fetch: (request: Request) => Promise<Response>;
  readonly trace: Trace;
};

type Found = {
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
    url: page.url(),
    pageUrl,
    challenge: detection.challenge,
    ...(detection.callback === undefined ? {} : { callback: detection.callback }),
  };
};

const isFound = (value: Found | Outcome): value is Found => 'challenge' in value;

/** Puts the token in, waits for the page, and says what it saw. */
const apply = async (
  page: Page,
  found: Found,
  token: string
): Promise<Outcome> => {
  if (solvePageUrl(page.url()) !== found.pageUrl) return { outcome: 'pageChanged' };
  const injected = await injectToken(page, {
    challenge: found.challenge,
    token,
    ...(found.callback === undefined ? {} : { callback: found.callback }),
  });
  await settle(page, found.url);

  if (page.url() !== found.url) return { outcome: 'solved', evidence: 'navigated' };
  const after = detect(await readFacts(page));
  if (after.kind === 'none') return { outcome: 'solved', evidence: 'challengeGone' };
  if (injected.callback === 'ran') return { outcome: 'solved', evidence: 'callbackRan' };
  if (sameChallenge(after, found) && (injected.filled > 0 || injected.executeAnswered))
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
  { solveId }: { readonly solveId: string }
): Promise<Outcome> =>
  needs.trace('captcha.solve', async (span) => {
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

    const outcome = await needs.trace('captcha.apply', () =>
      needs.withPage((page) => apply(page, found, solved.token))
    );
    span.set('captcha.outcome', outcome.outcome);
    if (outcome.outcome === 'solved') span.set('captcha.evidence', outcome.evidence);
    return outcome;
  });
