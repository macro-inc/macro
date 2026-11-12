import type {
  SlackLoginFailure,
  SlackLoginStep,
  SlackLoginWorkspace,
} from '@service-storage/slack-linked-wire';
import { match } from 'ts-pattern';

export type { SlackLoginFailure, SlackLoginStep, SlackLoginWorkspace };

/** One read of a sign-in attempt. */
export type LoginRead = {
  loginId: string;
  step: SlackLoginStep;
  expiresAt: string;
};

/** Why a sign-in request didn't reach a next step, in the dialog's vocabulary. */
export type LoginRequestFailure = {
  kind: 'login-request-failed';
  reason: /** The attempt moved on (another tab answered); re-read it. */
    | 'wrong-step'
    /** The attempt's ten minutes are up. */
    | 'expired'
    | 'rate-limited'
    /** DSS refused the input's shape. */
    | 'invalid-input'
    | 'unavailable'
    | 'signed-out'
    | 'unreachable';
};

export function loginRequestFailureMessage(
  failure: LoginRequestFailure
): string {
  return match(failure.reason)
    .with('wrong-step', () => 'This sign-in moved on. Showing where it is now.')
    .with('expired', () => 'This sign-in expired. Start again.')
    .with(
      'rate-limited',
      () => 'Too many tries at once. Wait a minute, then try again.'
    )
    .with(
      'invalid-input',
      () => "That doesn't look right. Check it and try again."
    )
    .with(
      'unavailable',
      () => 'Slack sign-in is unavailable right now. Try again in a moment.'
    )
    .with(
      'signed-out',
      () => 'Your Macro session expired. Sign in to Macro again first.'
    )
    .with(
      'unreachable',
      () => "Couldn't reach Macro. Check your connection and try again."
    )
    .exhaustive();
}

/** Why a sign-in ended without signing in, in words. */
export function loginFailureMessage(reason: SlackLoginFailure): string {
  return match(reason)
    .with('invalid_email', () => "Slack didn't accept that email address.")
    .with(
      'no_workspaces',
      () => 'No Slack workspace signs in with that email address.'
    )
    .with('code_expired', () => 'That code expired. Start again for a new one.')
    .with(
      'rate_limited',
      () =>
        'Slack is limiting sign-in attempts. Wait a few minutes, then start again.'
    )
    .with(
      'two_factor_expired',
      () => 'The two-factor step timed out. Start again.'
    )
    .with(
      'invalid_session',
      () =>
        "Slack didn't accept that session. Sign in again, or copy a fresh token and cookie."
    )
    .with('expired', () => 'This sign-in expired. Start again.')
    .with(
      'slack_unavailable',
      () => "Slack didn't answer. Try again in a few minutes."
    )
    .exhaustive();
}

/** A plausible email address; Slack has the last word. */
export function normalizeEmail(typed: string): string | undefined {
  const email = typed.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

/** Slack's emailed code (`ABC-123` or `ABC123`), upper-cased without spaces. */
export function normalizeEmailCode(typed: string): string | undefined {
  const code = typed.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{3}-?[A-Z0-9]{3}$/.test(code) ? code : undefined;
}

/** A six-digit two-factor code. */
export function normalizeTwoFactorCode(typed: string): string | undefined {
  const code = typed.replace(/\s+/g, '');
  return /^\d{6}$/.test(code) ? code : undefined;
}

/** A session pasted from a browser where Slack is signed in. */
export type PastedSession = {
  cookie: string;
  cookieDs: string | undefined;
  tokens: { token: string }[];
};

/** Why a pasted session can't be sent, in words. */
export type PastedSessionProblem = 'no-token' | 'bad-token' | 'bad-cookie';

export function pastedSessionProblemMessage(
  problem: PastedSessionProblem
): string {
  return match(problem)
    .with('no-token', () => 'Paste at least one token.')
    .with('bad-token', () => 'Each token starts with xoxc- (one per line).')
    .with('bad-cookie', () => "The d cookie's value starts with xoxd-.")
    .exhaustive();
}

/** `d=xoxd-…;` or `xoxd-…`: the cookie's value alone. */
function cookieValue(typed: string, name: string): string {
  const trimmed = typed.trim().replace(/;$/, '');
  return trimmed.startsWith(`${name}=`)
    ? trimmed.slice(name.length + 1)
    : trimmed;
}

/** One `xoxc-` token per line, the `d` cookie, and optionally `d-s`. */
export function parsePastedSession(input: {
  tokens: string;
  cookie: string;
  cookieDs: string;
}):
  | { ok: true; session: PastedSession }
  | { ok: false; problem: PastedSessionProblem } {
  const tokens = input.tokens
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) return { ok: false, problem: 'no-token' };
  if (tokens.some((token) => !/^xoxc-[\w-]+$/.test(token)))
    return { ok: false, problem: 'bad-token' };
  const cookie = cookieValue(input.cookie, 'd');
  if (!/^xoxd-\S+$/.test(cookie)) return { ok: false, problem: 'bad-cookie' };
  const cookieDs = cookieValue(input.cookieDs, 'd-s');
  return {
    ok: true,
    session: {
      cookie,
      cookieDs: cookieDs || undefined,
      tokens: [...new Set(tokens)].map((token) => ({ token })),
    },
  };
}

/** Workspaces checked when the picker opens: new ones that can sign in. */
export function initiallyPicked(
  workspaces: readonly SlackLoginWorkspace[]
): string[] {
  return workspaces
    .filter((workspace) => !workspace.alreadyConnected)
    .map((workspace) => workspace.teamId);
}

/** "Connect 2 workspaces". */
export function pickLabel(count: number): string {
  return `Connect ${count} ${count === 1 ? 'workspace' : 'workspaces'}`;
}
