import { fireAndForget } from '@core/util/fireAndForget';
import type { ResultAsync } from 'neverthrow';
import { createEffect, createSignal, on } from 'solid-js';
import type {
  CapturedSession,
  LoginAnswer,
  SlackLinkedCapabilities,
} from '../context/slack-linked-context';
import {
  type LoginRead,
  type LoginRequestFailure,
  loginRequestFailureMessage,
  type PastedSession,
  type SlackLoginStep,
} from '../core/login';

/** Where the dialog is before (or apart from) a server-side attempt. */
export type SignInPhase =
  /** Email first; desktop also offers Slack's own sign-in; pasting is advanced. */
  | { kind: 'start' }
  | { kind: 'paste' }
  /** Macro desktop's Slack window is open. */
  | { kind: 'browser' }
  | { kind: 'login'; loginId: string };

const TERMINAL: ReadonlySet<SlackLoginStep['kind']> = new Set([
  'done',
  'failed',
  'cancelled',
]);

/**
 * The sign-in dialog's state: which phase shows, the attempt it follows, and
 * the last request's failure. Every server step comes from the attempt's
 * read; answers return the next step at once.
 */
export function createSignInFlow(slack: SlackLinkedCapabilities) {
  const [open, setOpen] = createSignal(false);
  const [phase, setPhase] = createSignal<SignInPhase>({ kind: 'start' });
  const [pending, setPending] = createSignal(false);
  const [failure, setFailure] = createSignal<string>();
  const loginId = () => {
    const current = phase();
    return current.kind === 'login' ? current.loginId : '';
  };
  const login = slack.login(loginId);
  const step = (): SlackLoginStep | undefined => login.data?.step;

  // A finished sign-in refreshes the page once, behind the summary.
  createEffect(
    on(
      () => step()?.kind,
      (kind) => {
        if (kind === 'done')
          fireAndForget(slack.loginFinished(), 'slack-linked.login-finished');
      }
    )
  );

  const reset = () => {
    setPhase({ kind: 'start' });
    setFailure(undefined);
    setPending(false);
  };

  /** Runs one request; a refused one leaves the current step up. */
  const request = async (
    send: () => ResultAsync<LoginRead, LoginRequestFailure>
  ) => {
    if (pending()) return;
    setPending(true);
    setFailure(undefined);
    const result = await send();
    setPending(false);
    if (result.isOk()) {
      setPhase({ kind: 'login', loginId: result.value.loginId });
      return;
    }
    if (result.error.reason === 'wrong-step') login.refetch();
    setFailure(loginRequestFailureMessage(result.error));
  };

  const desktopSignIn = async (signInUrl: string | undefined) => {
    const desktop = slack.desktop;
    if (desktop.kind !== 'native') return;
    const returnTo = phase();
    setPhase({ kind: 'browser' });
    setFailure(undefined);
    const captured = await desktop.signIn(signInUrl);
    if (captured.isErr()) {
      setPhase(returnTo);
      if (captured.error.kind === 'failed') setFailure(captured.error.message);
      return;
    }
    setPhase(returnTo);
    await request(() =>
      slack.startSessionLogin({
        source: 'desktop',
        session: captured.value satisfies CapturedSession,
      })
    );
  };

  const solveCaptcha = async (siteKey: string, pageUrl: string) => {
    const desktop = slack.desktop;
    const id = loginId();
    if (desktop.kind !== 'native' || !id || pending()) return;
    setPending(true);
    setFailure(undefined);
    const solved = await desktop.captcha(siteKey, pageUrl);
    setPending(false);
    if (solved.isErr()) {
      if (solved.error.kind === 'failed') setFailure(solved.error.message);
      return;
    }
    await request(() =>
      slack.answerLogin(id, { step: 'captcha', solution: solved.value })
    );
  };

  /** Best effort: an abandoned attempt also expires on its own. */
  const cancelLogin = async (id: string) => {
    await slack.cancelLogin(id);
  };

  return {
    open,
    phase,
    login,
    step,
    pending,
    failure,
    setFailure,
    /** Opens the dialog at its start, or at an attempt handed off by id. */
    start: (resumeLoginId?: string) => {
      reset();
      if (resumeLoginId) setPhase({ kind: 'login', loginId: resumeLoginId });
      setOpen(true);
    },
    /** Opens the dialog straight into Macro desktop's Slack window. */
    startBrowser: () => {
      reset();
      setOpen(true);
      fireAndForget(desktopSignIn(undefined), 'slack-linked.browser');
    },
    showPaste: () => {
      setFailure(undefined);
      setPhase({ kind: 'paste' });
    },
    restart: reset,
    submitEmail: (email: string) => request(() => slack.startEmailLogin(email)),
    submitPasted: (session: PastedSession) =>
      request(() => slack.startSessionLogin({ source: 'manual', session })),
    answer: (answer: LoginAnswer) => {
      const id = loginId();
      return id ? request(() => slack.answerLogin(id, answer)) : undefined;
    },
    signInWithBrowser: desktopSignIn,
    solveCaptcha,
    /** Closing abandons an attempt still waiting on the person. */
    close: () => {
      const id = loginId();
      const kind = step()?.kind;
      if (id && kind && !TERMINAL.has(kind))
        fireAndForget(cancelLogin(id), 'slack-linked.cancel-login');
      setOpen(false);
      reset();
    },
    /** The person continued in Macro desktop; closing must not cancel. */
    handOff: () => {
      setOpen(false);
      reset();
    },
  };
}

export type SignInFlow = ReturnType<typeof createSignInFlow>;
