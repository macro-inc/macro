import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useEmail, useUserId } from '@core/context/user';
import { useAddInboxFlow } from '@core/email-link';
import { invalidateEmailLinks, useEmailLinksQuery } from '@queries/email/link';
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { GoogleAccountsStep } from '../components/GoogleAccountsStep';
import { resolveGoogleAccounts } from '../core/googleAccounts';

const CONNECT_ATTEMPT_KEY = 'onboarding-google-attempt';

/** Work is the owned inbox matching the Macro identity, never an arbitrary inbox. */
export function EmailStep(props: {
  mode?: 'work' | 'personal';
  onContinue: () => void;
  onSkip?: () => void;
}) {
  const userId = useUserId();
  const email = useEmail();
  const query = useEmailLinksQuery();
  const startAddInbox = useAddInboxFlow();
  const analytics = useAnalytics();
  const [connecting, setConnecting] = createSignal<'work' | 'personal'>();
  const [error, setError] = createSignal<string>();
  const links = () => (query.isSuccess ? query.data.links : []);
  const accounts = () => resolveGoogleAccounts(links(), userId(), email());

  onMount(() => {
    invalidateEmailLinks();
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') invalidateEmailLinks();
    }, 5_000);
    onCleanup(() => clearInterval(poll));
  });

  // The full-page OAuth return loses memory. Compare the confirmed result with
  // this user's saved attempt; never treat starting authorization as success.
  createEffect(() => {
    if (!query.isSuccess || query.isFetching) return;
    try {
      const raw = sessionStorage.getItem(CONNECT_ATTEMPT_KEY);
      if (!raw) return;
      const attempt = JSON.parse(raw);
      if (attempt.user !== userId()) return;
      sessionStorage.removeItem(CONNECT_ATTEMPT_KEY);
      if (attempt.slot === 'work' && !accounts().workConnected) {
        setError(
          `Your work inbox isn’t connected yet. Choose ${email()} on Google and approve the email permissions to continue.`
        );
      } else if (links().length > attempt.count) {
        analytics.track('onboarding_v4_email_connected', {
          connected_count: links().length,
        });
      }
    } catch {
      // Storage can be unavailable in private browsing; connection state is live.
    }
  });

  const connect = async (slot: 'work' | 'personal') => {
    if (
      connecting() ||
      !query.isSuccess ||
      (slot === 'personal' && !accounts().workConnected)
    )
      return;
    setError(undefined);
    setConnecting(slot);
    analytics.track('onboarding_v4_email_connect_clicked', { slot });
    try {
      try {
        sessionStorage.setItem(
          CONNECT_ATTEMPT_KEY,
          JSON.stringify({ user: userId(), slot, count: links().length })
        );
      } catch {
        /* Continue even if browser storage is unavailable. */
      }
      // Linking preserves the signed-in Macro identity. Google SSO is used only
      // on the public account-creation screen, never for this optional inbox.
      await startAddInbox();
    } catch {
      setError('Couldn’t open Google. Please try connecting again.');
    } finally {
      setConnecting(undefined);
    }
  };

  return (
    <GoogleAccountsStep
      mode={props.mode}
      onSkip={props.onSkip}
      accountEmail={email()}
      workConnected={accounts().workConnected}
      workNeedsReconnect={accounts().work?.needs_reauth}
      personalEmail={accounts().personal?.email_address}
      connecting={connecting()}
      loading={query.isPending}
      disabled={query.isError}
      error={
        query.isError
          ? 'We couldn’t check your connected accounts. Please try again.'
          : error()
      }
      onRetry={query.isError ? () => void query.refetch() : undefined}
      onConnectWork={() => void connect('work')}
      onConnectPersonal={() => void connect('personal')}
      onContinue={() => {
        if (accounts().workConnected) props.onContinue();
      }}
    />
  );
}
