import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal, onCleanup } from 'solid-js';
import type {
  AuthContext,
  AuthIntent,
  VerifyCodeResult,
} from '../context/auth-context';
import { isCompleteCode, RESEND_AFTER_SECONDS } from '../core/email-code';

export type LoginStep = 'choose' | 'email' | 'verify';

const VERIFY_ERRORS = {
  'invalid-code': 'Invalid code.',
  'rate-limited': 'Too many attempts. Wait a minute, then try again.',
  failed: 'Unable to perform verification.',
} satisfies Record<Exclude<VerifyCodeResult['t'], 'verified'>, string>;

type EmailLoginCapabilities = Pick<
  AuthContext,
  | 'session'
  | 'sendEmailCode'
  | 'verifyEmailCode'
  | 'completeLogin'
  | 'identify'
  | 'track'
>;

/**
 * Sign-in by emailed one-time code (or, for a few accounts, a password):
 * choose a method, send the code, verify it, then refresh the session.
 */
export function createEmailLogin(
  context: EmailLoginCapabilities,
  options: {
    intent: AuthIntent;
    initialEmail?: string;
    /** Send the code for `initialEmail` right away (dev persona links). */
    autoStart?: boolean;
    /** After a verified sign-in, before the session swaps the page. */
    onVerified?: () => void;
  }
) {
  const [step, setStep] = createSignal<LoginStep>(
    options.initialEmail ? 'email' : 'choose'
  );
  const [email, setEmail] = createSignal(options.initialEmail ?? '');
  const [password, setPassword] = createSignal('');
  const [passwordRequired, setPasswordRequired] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [sendError, setSendError] = createSignal<string>();
  const [code, setCode] = createSignal('');
  const [verifying, setVerifying] = createSignal(false);
  const [verifyError, setVerifyError] = createSignal<string>();
  const [resendIn, setResendIn] = createSignal(0);

  let countdown: ReturnType<typeof setInterval> | undefined;
  const startResendCountdown = () => {
    clearInterval(countdown);
    setResendIn(RESEND_AFTER_SECONDS);
    countdown = setInterval(() => {
      setResendIn((seconds) => Math.max(0, seconds - 1));
      if (resendIn() === 0) clearInterval(countdown);
    }, 1000);
  };
  onCleanup(() => clearInterval(countdown));

  const finish = async () => {
    await context.completeLogin();
    const session = context.session();
    if (session.t === 'signed-in') {
      context.track('login', { method: 'email' });
      context.identify(session.user);
    }
    options.onVerified?.();
  };

  const verify = async (value = code()) => {
    const address = email();
    if (verifying() || !isCompleteCode(value) || !address) return;
    setVerifying(true);
    setVerifyError();
    const result = await context.verifyEmailCode({
      email: address,
      code: value,
    });
    if (result.t === 'verified') {
      await finish();
      return;
    }
    setVerifying(false);
    // The auth service allows only a few attempts a minute per address, and
    // a rejected code left in the boxes would spend another on Verify.
    if (result.t === 'invalid-code') setCode('');
    setVerifyError(VERIFY_ERRORS[result.t]);
  };

  /** Send (or resend) the code; reports whether a code went out. */
  const send = async (): Promise<boolean> => {
    const address = email().trim();
    if (sending() || !address) return false;
    setSending(true);
    setSendError();
    try {
      const result = await context.sendEmailCode({
        email: address,
        password: passwordRequired() ? password() : undefined,
      });
      switch (result.t) {
        case 'code-sent':
          setEmail(address);
          setCode('');
          setStep('verify');
          startResendCountdown();
          if (result.autoCode) {
            setCode(result.autoCode);
            fireAndForget(verify(result.autoCode), 'email-login');
          }
          return true;
        case 'password-required':
          setPasswordRequired(true);
          return false;
        case 'signed-in':
          await finish();
          return false;
        case 'redirected':
          return false;
        case 'failed':
          setSendError(result.message);
          return false;
      }
    } finally {
      setSending(false);
    }
  };

  if (options.autoStart && options.initialEmail)
    fireAndForget(send(), 'email-login');

  return {
    step,
    email,
    setEmail,
    password,
    setPassword,
    passwordRequired,
    sending,
    sendError,
    code,
    setCode,
    verifying,
    verifyError,
    resendIn,
    canVerify: () => isCompleteCode(code()) && !verifying(),
    chooseEmail: () => {
      if (options.intent === 'signup')
        context.track('sign_up_click', { method: 'email' });
      setStep('email');
    },
    submitEmail: () => fireAndForget(send(), 'email-login'),
    verify: (value?: string) => fireAndForget(verify(value), 'email-login'),
    resend: async () => {
      setVerifyError();
      // A failed resend may be retried at once; a sent one restarts the wait.
      if (!(await send())) setResendIn(0);
    },
    back: () => {
      if (step() === 'verify') {
        setCode('');
        setVerifyError();
        setStep('email');
      } else {
        setSendError();
        setStep('choose');
      }
    },
  };
}

export type EmailLogin = ReturnType<typeof createEmailLogin>;
