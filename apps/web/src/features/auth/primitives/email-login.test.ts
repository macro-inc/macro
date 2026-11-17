import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { AuthSession, VerifyCodeResult } from '../context/auth-context';
import { createEmailLogin } from './email-login';

const pending = vi.hoisted(() => [] as Promise<void>[]);
vi.mock('@core/util/fireAndForget', () => ({
  fireAndForget(work: Promise<void>) {
    pending.push(work);
    work.catch(() => {});
  },
}));
afterEach(() => {
  pending.length = 0;
});

function setup() {
  const failure = new Error('Contact cleanup failed');
  const completeLogin = vi.fn(async () => {}).mockRejectedValueOnce(failure);
  const verified = vi.fn();
  const context = {
    session: (): AuthSession => ({ t: 'signed-out' }),
    sendEmailCode: vi.fn(async () => ({ t: 'code-sent' as const })),
    // The server consumes a successful code before local cleanup runs.
    verifyEmailCode: vi
      .fn<() => Promise<VerifyCodeResult>>()
      .mockResolvedValueOnce({ t: 'verified' })
      .mockResolvedValue({ t: 'invalid-code' }),
    completeLogin,
    identify: vi.fn(),
    track: vi.fn(),
  };
  const owner = createRoot((dispose) => ({
    login: createEmailLogin(context, {
      intent: 'login',
      initialEmail: 'user@example.com',
      onVerified: verified,
    }),
    dispose,
  }));
  return { ...owner, context, failure, completeLogin, verified };
}

it('retries local completion without resubmitting a consumed code', async () => {
  const { login, dispose, context, failure, completeLogin, verified } = setup();
  try {
    login.setCode('424242');
    login.verify();
    expect(login.verifying()).toBe(true);
    await expect(pending.at(-1)).rejects.toBe(failure);
    expect(login.verifying()).toBe(false);
    expect(login.canVerify()).toBe(true);
    expect(verified).not.toHaveBeenCalled();
    // Repeating the same input does not start a different login attempt.
    login.setEmail('user@example.com');
    login.verify();
    await pending.at(-1);
    expect(context.verifyEmailCode).toHaveBeenCalledOnce();
    expect(completeLogin).toHaveBeenCalledTimes(2);
    expect(verified).toHaveBeenCalledOnce();
    expect(login.verifying()).toBe(true);
  } finally {
    dispose();
  }
});

it.each(['address', 'back', 'resend', 'send', 'choose'] as const)(
  'requires a fresh server verification after %s starts another attempt',
  async (action) => {
    const { login, dispose, context, failure, completeLogin, verified } =
      setup();
    try {
      login.submitEmail();
      await pending.at(-1);
      login.setCode('424242');
      login.verify();
      await expect(pending.at(-1)).rejects.toBe(failure);
      switch (action) {
        case 'address':
          login.setEmail('other@example.com');
          break;
        case 'back':
          login.back();
          break;
        case 'resend':
          await login.resend();
          break;
        case 'send':
          login.submitEmail();
          await pending.at(-1);
          break;
        case 'choose':
          login.chooseEmail();
          break;
      }
      login.setCode('424242');
      login.verify();
      await pending.at(-1);
      expect(context.verifyEmailCode).toHaveBeenCalledTimes(2);
      expect(login.verifyError()).toBe('Invalid code.');
      expect(login.verifying()).toBe(false);
      expect(completeLogin).toHaveBeenCalledOnce();
      expect(verified).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  }
);

it('does not carry late verification into a replacement attempt', async () => {
  const { login, dispose, context, completeLogin, verified } = setup();
  const result = Promise.withResolvers<VerifyCodeResult>();
  context.verifyEmailCode
    .mockReset()
    .mockImplementationOnce(() => result.promise)
    .mockResolvedValue({ t: 'invalid-code' });
  try {
    login.setCode('424242');
    login.verify();
    const oldVerification = pending.at(-1);
    login.back();
    login.setEmail('other@example.com');
    result.resolve({ t: 'verified' });
    await oldVerification;
    expect(completeLogin).not.toHaveBeenCalled();
    expect(verified).not.toHaveBeenCalled();
    login.setCode('424242');
    login.verify();
    await pending.at(-1);
    expect(context.verifyEmailCode).toHaveBeenCalledTimes(2);
    expect(login.verifyError()).toBe('Invalid code.');
    expect(completeLogin).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});
