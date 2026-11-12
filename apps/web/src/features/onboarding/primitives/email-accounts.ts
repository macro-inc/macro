import { fireAndForget } from '@core/util/fireAndForget';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import type {
  EmailAccountsSource,
  InboxProvider,
  Loadable,
  OnboardingContext,
} from '../context/onboarding-context';
import { type EmailAccount, orderEmailAccounts } from '../core/email-accounts';
import { readConnectBaseline, saveConnectBaseline } from './flow-storage';

/** How often the step re-checks for freshly-linked inboxes while visible. */
const EMAIL_ACCOUNTS_POLL_MS = 5_000;

export type InboxSlot = 'work' | 'personal';

/**
 * Connecting Google and Outlook inboxes. On web, connecting is a full-page OAuth redirect,
 * so a landed link is detected against a baseline saved before leaving.
 */
export function createEmailAccounts(
  context: Pick<OnboardingContext, 'viewer' | 'connectInbox' | 'track'>,
  source: EmailAccountsSource
) {
  const [connecting, setConnecting] = createSignal<InboxSlot>();
  const [connectingProvider, setConnectingProvider] =
    createSignal<InboxProvider>();

  // The links have a long stale time; a connect that just completed (this tab
  // or another) must show up the moment the user is back.
  fireAndForget(source.refresh(), 'onboarding');
  const interval = setInterval(
    () => fireAndForget(source.refresh(), 'onboarding'),
    EMAIL_ACCOUNTS_POLL_MS
  );
  onCleanup(() => clearInterval(interval));

  const accounts = (): Loadable<EmailAccount[]> => {
    const state = source.accounts();
    if (state.t !== 'ready') return state;
    const viewer = context.viewer();
    return {
      t: 'ready',
      value: orderEmailAccounts(
        state.value.filter((account) => account.provider !== 'ROX'),
        viewer.t === 'signed-in' ? viewer.viewer.id : undefined
      ),
    };
  };
  const list = () => {
    const state = accounts();
    return state.t === 'ready' ? state.value : [];
  };

  createEffect(() => {
    const state = source.accounts();
    if (state.t !== 'ready') return;
    const baseline = readConnectBaseline();
    if (baseline === undefined) return;
    const count = state.value.length;
    if (count > baseline)
      context.track('onboarding_v4_email_connected', {
        connected_count: count,
      });
    if (count !== baseline) saveConnectBaseline(undefined);
  });

  /** Without a provider the app asks which one. */
  const connect = async (slot: InboxSlot, provider?: InboxProvider) => {
    if (connecting() !== undefined) return;
    setConnecting(slot);
    setConnectingProvider(provider);
    context.track('onboarding_v4_email_connect_clicked', { slot });
    saveConnectBaseline(list().length);
    try {
      await context.connectInbox(provider);
    } finally {
      setConnecting(undefined);
      setConnectingProvider(undefined);
    }
  };

  return {
    accounts,
    primary: () => list()[0],
    secondary: () => list()[1],
    connecting,
    connectingProvider,
    connect,
    retry: () => fireAndForget(source.refresh(), 'onboarding'),
  };
}
