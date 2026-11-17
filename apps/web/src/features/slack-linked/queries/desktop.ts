import { isPlatform, isTauri } from '@core/util/platform';
import { invoke } from '@tauri-apps/api/core';
import { ResultAsync } from 'neverthrow';
import { match, P } from 'ts-pattern';
import type {
  CapturedSession,
  DesktopFailure,
} from '../context/slack-linked-context';

/** Whether this is Macro desktop, which can open Slack in its own window. */
export function canSignInOnDesktop(): boolean {
  return isTauri() && isPlatform('desktop');
}

/** `slack_desktop::SlackDesktopError` from the desktop app, in words. */
function desktopFailure(error: unknown): DesktopFailure {
  return (
    match(error)
      .returnType<DesktopFailure>()
      .with('cancelled', () => ({ kind: 'cancelled' }))
      .with('busy', () => ({
        kind: 'failed',
        message: 'A Slack window is already open. Finish or close it first.',
      }))
      .with('timed_out', () => ({
        kind: 'failed',
        message: 'The Slack window timed out. Try again.',
      }))
      .with('no_session', () => ({
        kind: 'failed',
        message:
          "Macro couldn't read your Slack session from that window. Try again, or paste a token and cookie.",
      }))
      .with('captcha_unavailable', () => ({
        kind: 'failed',
        message: "Slack's verification couldn't load. Try again.",
      }))
      .with('invalid_url', () => ({
        kind: 'failed',
        message: "Slack's sign-in link wasn't one Macro can open. Start again.",
      }))
      // Desktop builds from before the command answer "command ... not found".
      .with(P.string.regex(/not found/i), () => ({
        kind: 'failed',
        message:
          'Update Macro desktop to sign in to Slack here, then try again.',
      }))
      .otherwise(() => ({
        kind: 'failed',
        message: "The Slack window couldn't open. Try again.",
      }))
  );
}

type WireCapturedSession = {
  cookie: string;
  cookieDs: string | null;
  tokens: { token: string; teamId: string | null }[];
};

/**
 * Slack's sign-in in a separate desktop window with a throwaway profile; the
 * session comes back only to this call and goes only to DSS.
 */
export function signInOnDesktop(
  signInUrl: string | undefined
): ResultAsync<CapturedSession, DesktopFailure> {
  return ResultAsync.fromPromise(
    invoke<WireCapturedSession>('slack_desktop_sign_in', {
      signInUrl: signInUrl ?? null,
    }),
    desktopFailure
  ).map((session) => ({
    cookie: session.cookie,
    cookieDs: session.cookieDs ?? undefined,
    tokens: session.tokens.map((token) => ({
      token: token.token,
      teamId: token.teamId ?? undefined,
    })),
  }));
}

/** Slack's captcha rendered on slack.com in a desktop window. */
export function solveCaptchaOnDesktop(
  siteKey: string,
  pageUrl: string
): ResultAsync<string, DesktopFailure> {
  return ResultAsync.fromPromise(
    invoke<string>('slack_desktop_captcha', { siteKey, pageUrl }),
    desktopFailure
  );
}

/**
 * A deep link that opens External's Slack page in Macro desktop: at a
 * sign-in by id, or straight into Slack's own sign-in.
 */
export function desktopSignInUrl(loginId: string | undefined): string {
  return `macro:///external?slackLogin=${encodeURIComponent(loginId ?? 'browser')}`;
}
