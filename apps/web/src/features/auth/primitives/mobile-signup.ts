import { createSignal } from 'solid-js';
import type { AuthContext } from '../context/auth-context';
import { mobileWelcomeFailure } from '../core/mobile-welcome';

/**
 * Mobile-web visitors leave their email and get a link to open on desktop,
 * instead of signing up on a phone.
 */
export function createMobileSignup(
  context: Pick<
    AuthContext,
    'sendMobileWelcomeEmail' | 'identify' | 'notifyFailure'
  >
) {
  const [pending, setPending] = createSignal(false);
  const [submitted, setSubmitted] = createSignal<string>();

  const submit = async (email: string) => {
    const address = email.trim();
    // An empty submit keeps the visitor on the capture step.
    if (!address || pending()) return;
    context.identify({ id: address, email: address });
    setPending(true);
    try {
      const result = await context.sendMobileWelcomeEmail(address);
      const failure = mobileWelcomeFailure(result);
      if (failure) context.notifyFailure(failure);
      else setSubmitted(address);
    } finally {
      setPending(false);
    }
  };

  return { pending, submitted, submit };
}
