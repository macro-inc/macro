import { toast } from '@core/component/Toast/Toast';
import { createSignal, onMount } from 'solid-js';
import type { SlackLinkedCapabilities } from '../context/slack-linked-context';
import { accountsView, type SlackAccount } from '../core/account';
import {
  addFailureMessage,
  type SlackConversation,
} from '../core/conversation';
import { createSignInFlow } from './sign-in-flow';

/** How the page was opened from another device or a deep link. */
export type SlackHandoff =
  /** Continue this sign-in attempt (a captcha or SSO step). */
  | { kind: 'login'; loginId: string }
  /** Open Slack's own sign-in in a Macro desktop window. */
  | { kind: 'browser' };

/**
 * The Slack page's state, shared by its desktop and mobile views: accounts,
 * the catalogue and its search, adding, disconnecting, and sign-in.
 */
export function createSlackPage(
  slack: SlackLinkedCapabilities,
  handoff: SlackHandoff | undefined
) {
  const view = () =>
    slack.accounts.data ? accountsView(slack.accounts.data) : undefined;
  const hasLive = () => (view()?.live.length ?? 0) > 0;
  const catalogue = slack.catalogue(hasLive);
  const [query, setQuery] = createSignal('');
  const flow = createSignInFlow(slack);
  onMount(() => {
    if (!handoff) return;
    if (handoff.kind === 'login') flow.start(handoff.loginId);
    else if (slack.desktop.kind === 'native') flow.startBrowser();
    else flow.start();
  });

  const [disconnecting, setDisconnecting] = createSignal<SlackAccount>();
  const [signOut, setSignOut] = createSignal(true);
  const askDisconnect = (account: SlackAccount) => {
    setSignOut(true);
    setDisconnecting(account);
  };
  const disconnect = async (account: SlackAccount) => {
    const result = await slack.disconnect(account, { signOut: signOut() });
    setDisconnecting(undefined);
    if (result.isErr()) {
      toast.failure(`Couldn't disconnect ${account.teamName}. Try again.`);
      return;
    }
    toast.success(`Disconnected ${account.teamName}.`);
  };

  const [adding, setAdding] = createSignal<ReadonlySet<string>>(new Set());
  const [addErrors, setAddErrors] = createSignal<Record<string, string>>({});
  const setPending = (remoteId: string, pending: boolean) =>
    setAdding((current) => {
      const next = new Set(current);
      if (pending) next.add(remoteId);
      else next.delete(remoteId);
      return next;
    });
  const add = async (conversation: SlackConversation) => {
    const id = conversation.remoteId;
    if (adding().has(id)) return;
    setAddErrors(({ [id]: _previous, ...rest }) => rest);
    setPending(id, true);
    const result = await slack.add(conversation);
    setPending(id, false);
    if (result.isErr()) {
      setAddErrors((current) => ({
        ...current,
        [id]: addFailureMessage(result.error),
      }));
      return;
    }
    const { chatId } = result.value;
    toast.success(`Added ${conversation.name}`, {
      subtext: 'Macro is bringing in its last 90 days of messages',
      dismissStyle: 'icon',
      actions: [{ label: 'Open', onClick: () => slack.openChat(chatId) }],
    });
  };

  return {
    slack,
    view,
    hasLive,
    catalogue,
    query,
    setQuery,
    flow,
    disconnecting,
    setDisconnecting,
    askDisconnect,
    signOut,
    setSignOut,
    disconnect,
    adding,
    addErrors,
    add,
  };
}

export type SlackPageState = ReturnType<typeof createSlackPage>;
