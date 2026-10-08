import { createEffect, createSignal, onCleanup } from 'solid-js';
import type {
  EmailAccountsSource,
  Loadable,
  OnboardingContext,
} from '../context/onboarding-context';
import { type EmailAccount, orderEmailAccounts } from '../core/email-accounts';
import { readConnectBaseline, saveConnectBaseline } from './flow-storage';

/** How often the step re-checks for freshly-linked inboxes while visible. */
const EMAIL_ACCOUNTS_POLL_MS = 5_000;

export type InboxSlot = 'work' | 'personal';

/**
 * Connecting Google inboxes. On web, connecting is a full-page OAuth redirect,
 * so a landed link is detected against a baseline saved before leaving.
 */
export function createEmailAccounts(
  context: Pick<OnboardingContext, 'viewer' | 'connectInbox' | 'track'>,
  source: EmailAccountsSource
) {
  const [connecting, setConnecting] = createSignal<InboxSlot>();

  // The links have a long stale time; a connect that just completed (this tab
  // or another) must show up the moment the user is back.
  void source.refresh();
  const interval = setInterval(
    () => void source.refresh(),
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
        state.value,
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

  const connect = async (slot: InboxSlot) => {
    if (connecting() !== undefined) return;
    setConnecting(slot);
    context.track('onboarding_v4_email_connect_clicked', { slot });
    saveConnectBaseline(list().length);
    try {
      await context.connectInbox();
    } finally {
      setConnecting(undefined);
    }
  };

  return {
    accounts,
    primary: () => list()[0],
    secondary: () => list()[1],
    connecting,
    connect,
    retry: () => void source.refresh(),
  };
}
