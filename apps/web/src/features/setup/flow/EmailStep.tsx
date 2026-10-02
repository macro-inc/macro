import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useUserId } from '@core/context/user';
import { useAddInboxFlow } from '@core/email-link';
import { invalidateEmailLinks, useEmailLinksQuery } from '@queries/email/link';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { GoogleAccountsStep } from '../components/GoogleAccountsStep';

/** How often the step re-checks for freshly-linked inboxes while visible. */
const LINKS_POLL_MS = 5_000;

/** The inbox count at the moment a connect was started — the web OAuth
 * round-trip reloads the page, so detecting "a link landed" after the
 * return needs a pre-redirect baseline that survives the reload. */
const CONNECT_BASELINE_KEY = 'onboarding-flow-email-baseline';

/** Connect Google accounts. On web the add-inbox flow is a full-page OAuth
 * redirect; the flow's persisted step brings the user back here. */
export function EmailStep(props: {
  mode: 'work' | 'personal';
  onContinue: () => void;
  onSkip: () => void;
}) {
  const linksQuery = useEmailLinksQuery();
  const userId = useUserId();
  const startAddInbox = useAddInboxFlow();
  const analytics = useAnalytics();
  const [connecting, setConnecting] = createSignal<'work' | 'personal'>();

  // The links query has a long stale time; a connect that just completed
  // (this tab or another) must show up the moment the user is back.
  onMount(() => {
    void invalidateEmailLinks();
    const interval = setInterval(
      () => void invalidateEmailLinks(),
      LINKS_POLL_MS
    );
    onCleanup(() => clearInterval(interval));
  });

  // No macro_id ownership filter: linking a mailbox owned by another Macro
  // user creates a SHARED link carrying the owner's macro_id — filtering
  // would hide an inbox the user just connected.
  const links = createMemo(() => {
    const uid = userId();
    return [...(linksQuery.isSuccess ? linksQuery.data.links : [])].sort(
      (a, b) =>
        Number(b.is_primary && b.macro_id === uid) -
        Number(a.is_primary && a.macro_id === uid)
    );
  });

  // Detects a landed link via the persisted pre-redirect baseline (the
  // OAuth round-trip reloads the page, so in-memory state won't survive).
  createEffect(() => {
    if (!linksQuery.isSuccess) return;
    const count = linksQuery.data.links.length;
    const raw = sessionStorage.getItem(CONNECT_BASELINE_KEY);
    if (raw === null) return;
    const baseline = Number(raw);
    if (Number.isFinite(baseline) && count > baseline) {
      analytics.track('onboarding_v4_email_connected', {
        connected_count: count,
      });
    }
    if (count !== baseline) sessionStorage.removeItem(CONNECT_BASELINE_KEY);
  });

  const connect = async (slot: 'work' | 'personal') => {
    if (connecting() !== undefined) return;
    setConnecting(slot);
    analytics.track('onboarding_v4_email_connect_clicked', { slot });
    sessionStorage.setItem(
      CONNECT_BASELINE_KEY,
      String(linksQuery.isSuccess ? linksQuery.data.links.length : 0)
    );
    try {
      await startAddInbox();
    } finally {
      setConnecting(undefined);
    }
  };

  return (
    <GoogleAccountsStep
      mode={props.mode}
      accountEmail={links()[0]?.email_address}
      workConnected={links().length > 0}
      personalEmail={links()[1]?.email_address}
      connecting={connecting()}
      loading={linksQuery.isPending}
      error={
        linksQuery.isError
          ? "Couldn't load your connected accounts."
          : undefined
      }
      onRetry={() => void linksQuery.refetch()}
      onConnectWork={() => void connect('work')}
      onConnectPersonal={() => void connect('personal')}
      onContinue={props.onContinue}
      onSkip={props.onSkip}
    />
  );
}
