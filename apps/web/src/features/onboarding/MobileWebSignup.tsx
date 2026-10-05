import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { useSendMobileWelcomeEmail } from '@queries/auth';
import { createSignal, Match, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import MobileWebSignupSent from './MobileWebSignupSent';
import MobileWebWelcome from './MobileWebWelcome';

/**
 * Mobile-web entry flow for unauthenticated visitors on a phone/tablet browser.
 *
 * Signing up on mobile web is a poor experience, so instead of pushing visitors
 * through Google SSO + onboarding we capture their email and send them a link
 * to open on desktop (POST /mobile-welcome-email on the auth service). The two
 * screens are:
 *   1. {@link MobileWebWelcome} — captures the email.
 *   2. {@link MobileWebSignupSent} — confirms "we emailed you a desktop link".
 *
 * Identifying the email also hands it to the analytics providers so downstream
 * marketing automation can pick it up.
 */
export default function MobileWebSignup() {
  const analytics = useAnalytics();
  const sendWelcomeEmail = useSendMobileWelcomeEmail();
  const [submittedEmail, setSubmittedEmail] = createSignal<string | null>(null);

  const handleSignUp = async (email: string) => {
    const trimmed = email.trim();
    // Don't advance on an empty submit — keep the visitor on the capture step.
    if (!trimmed || sendWelcomeEmail.isPending) return;
    analytics.identify(trimmed, { email: trimmed });

    const result = await sendWelcomeEmail.mutateAsync(trimmed);
    if (result.isErr()) {
      match(result.error[0]?.code)
        .with('INVALID_EMAIL', () => toast.failure('Invalid email address.'))
        .with('RATE_LIMITED', () =>
          toast.failure('Too many attempts. Please try again later.')
        )
        .otherwise(() =>
          toast.failure('Something went wrong. Please try again.')
        );
      return;
    }

    // `sent: false` means we already emailed this address — the confirmation
    // screen is still accurate, so advance either way.
    setSubmittedEmail(trimmed);
  };

  return (
    <Switch fallback={<MobileWebWelcome onSignUp={handleSignUp} />}>
      <Match when={submittedEmail() !== null}>
        <MobileWebSignupSent email={submittedEmail() ?? undefined} />
      </Match>
    </Switch>
  );
}
