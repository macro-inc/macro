import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { AuthSession } from '../context/auth-context';
import { createEmailLogin } from './email-login';

const pending = vi.hoisted(() => [] as Promise<void>[]);
vi.mock('@core/util/fireAndForget', () => ({
  fireAndForget(work: Promise<void>) {
    pending.push(work);
    // Observe the original rejection below without an unhandled rejection.
    work.catch(() => {});
  },
}));

it('releases verification after failed login cleanup and permits a successful retry', async () => {
  const failure = new Error('Contact cleanup failed');
  const completeLogin = vi.fn(async () => {}).mockRejectedValueOnce(failure);
  const verified = vi.fn();
  const context = {
    session: (): AuthSession => ({ t: 'signed-out' }),
    sendEmailCode: vi.fn(async () => ({ t: 'code-sent' as const })),
    verifyEmailCode: vi.fn(async () => ({ t: 'verified' as const })),
    completeLogin,
    identify: vi.fn(),
    track: vi.fn(),
  };
  const { login, dispose } = createRoot((dispose) => ({
    login: createEmailLogin(context, {
      intent: 'login',
      initialEmail: 'user@example.com',
      onVerified: verified,
    }),
    dispose,
  }));
  try {
    login.setCode('424242');
    login.verify();
    expect(login.verifying()).toBe(true);
    await expect(pending.at(-1)).rejects.toBe(failure);
    expect(login.verifying()).toBe(false);
    expect(login.canVerify()).toBe(true);
    expect(verified).not.toHaveBeenCalled();
    login.verify();
    await pending.at(-1);
    expect(context.verifyEmailCode).toHaveBeenCalledTimes(2);
    expect(completeLogin).toHaveBeenCalledTimes(2);
    expect(verified).toHaveBeenCalledOnce();
    // Successful handoff keeps the existing busy state until the view changes.
    expect(login.verifying()).toBe(true);
  } finally {
    dispose();
    pending.length = 0;
  }
});
