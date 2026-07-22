import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { createSignal, Match, Switch } from 'solid-js';
import MobileWebSignupSent from './MobileWebSignupSent';
import MobileWebWelcome from './MobileWebWelcome';

/**
 * Mobile-web entry flow for unauthenticated visitors on a phone/tablet browser.
 *
 * Signing up on mobile web is a poor experience, so instead of pushing visitors
 * through Google SSO + onboarding we capture their email and tell them we've
 * emailed a link to open on desktop. The two screens are:
 *   1. {@link MobileWebWelcome} — captures the email.
 *   2. {@link MobileWebSignupSent} — confirms "we emailed you a desktop link".
 *
 * Identifying the email hands it to the analytics providers, which is what the
 * downstream marketing automation keys the desktop-download email off of.
 */
export default function MobileWebSignup() {
  const analytics = useAnalytics();
  const [submittedEmail, setSubmittedEmail] = createSignal<string | null>(null);

  const handleSignUp = (email: string) => {
    const trimmed = email.trim();
    // Don't advance on an empty submit — keep the visitor on the capture step.
    if (!trimmed) return;
    analytics.identify(trimmed, { email: trimmed });
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
