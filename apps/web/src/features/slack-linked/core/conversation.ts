import { match } from 'ts-pattern';
import type { SlackAccount } from './account';

/** Where a Slack conversation already is in Macro for this viewer. */
export type InMacro =
  | { kind: 'own'; chatId: string }
  | { kind: 'shared'; chatId: string; ownerId: string; ownerName: string };

export type CannotAdd = 'archived' | 'frozen' | 'not_member';

/** Another organization in a Slack Connect conversation. */
export type ConnectedOrg = { teamId: string; name: string };

/** A Slack Connect channel or DM the person's workspaces see. */
export type SlackConversation = {
  remoteId: string;
  kind: 'group' | 'direct';
  /** `#shared-launch`, or the other person's name for a DM. */
  name: string;
  isPrivate: boolean;
  isArchived: boolean;
  /** The connection was severed: read-only. */
  frozen: boolean;
  /** The other organizations; a DM's is the other person's. */
  orgs: ConnectedOrg[];
  /** The person's account ids that see it, the first one leading. */
  accountIds: string[];
  lastActivityAt: string | undefined;
  inMacro: InMacro | undefined;
  canAdd: boolean;
  cannotAddReason: CannotAdd | undefined;
};

/** One workspace's conversations on the Slack page. */
export type WorkspaceCatalogue = {
  account: SlackAccount;
  channels: SlackConversation[];
  direct: SlackConversation[];
  /** Conversations Macro can't hold, with the reason for each. */
  unsupported: SlackConversation[];
};

export function matchesConversationQuery(
  conversation: SlackConversation,
  query: string
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [conversation.name, ...conversation.orgs.map((org) => org.name)].some(
    (text) => text.toLowerCase().includes(needle)
  );
}

/**
 * The catalogue under each live workspace, in DSS's order. A conversation the
 * person reaches from several workspaces shows once, under the first live one
 * that sees it.
 */
export function workspaceCatalogues(
  accounts: readonly SlackAccount[],
  conversations: readonly SlackConversation[],
  query = ''
): WorkspaceCatalogue[] {
  const live = new Set(accounts.map((account) => account.id));
  const home = (conversation: SlackConversation) =>
    conversation.accountIds.find((id) => live.has(id));
  const visible = conversations.filter((conversation) =>
    matchesConversationQuery(conversation, query)
  );
  return accounts.map((account) => {
    const own = visible.filter(
      (conversation) => home(conversation) === account.id
    );
    const listed = own.filter(
      (conversation) => conversation.canAdd || !!conversation.inMacro
    );
    return {
      account,
      channels: listed.filter((conversation) => conversation.kind === 'group'),
      direct: listed.filter((conversation) => conversation.kind === 'direct'),
      unsupported: own.filter(
        (conversation) => !conversation.canAdd && !conversation.inMacro
      ),
    };
  });
}

/** Section ids, stable across sessions for the remembered open state. */
export const workspaceSectionId = {
  channels: (accountId: string) => `${accountId}:channels`,
  direct: (accountId: string) => `${accountId}:direct`,
};

/** "Slack Connect · Private channel", muted beside the name. */
export function conversationMetadata(conversation: SlackConversation): string {
  const kind =
    conversation.kind === 'direct'
      ? 'Direct message'
      : conversation.isPrivate
        ? 'Private channel'
        : 'Channel';
  return [
    'Slack Connect',
    kind,
    conversation.frozen ? 'Disconnected' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function cannotAddLabel(reason: CannotAdd): string {
  return match(reason)
    .with('archived', () => 'Archived in Slack')
    .with('frozen', () => 'Disconnected from the other organization')
    .with('not_member', () => "You're not in this conversation")
    .exhaustive();
}

/** Why adding a conversation did not happen. */
export type AddFailure = {
  kind: 'add-failed';
  reason:
    | 'not-allowed'
    | 'gone'
    | 'already-added'
    | 'disconnected'
    | 'rate-limited'
    | 'cannot-add'
    | 'unavailable'
    | 'server-error'
    | 'signed-out'
    | 'unreachable';
  why?: CannotAdd;
};

/** Specific words for each refusal; never a catch-all. */
export function addFailureMessage(failure: AddFailure): string {
  return match(failure)
    .with(
      { reason: 'not-allowed' },
      () => "Your Slack can't add this conversation. Check you're still in it."
    )
    .with({ reason: 'gone' }, () => 'This conversation is no longer in Slack.')
    .with(
      { reason: 'already-added' },
      () => 'This conversation is already in Macro.'
    )
    .with(
      { reason: 'disconnected' },
      () => 'This workspace is disconnected. Sign in again, then add it.'
    )
    .with(
      { reason: 'rate-limited' },
      () => 'Too many requests at once. Wait a second, then add it again.'
    )
    .with({ reason: 'cannot-add' }, ({ why }) =>
      why ? `${cannotAddLabel(why)}.` : "This conversation can't be added."
    )
    .with(
      { reason: 'unavailable' },
      () => 'Slack is temporarily unavailable. Try again in a moment.'
    )
    .with(
      { reason: 'server-error' },
      () =>
        'Macro hit an error adding this conversation. If it keeps happening, tell us.'
    )
    .with(
      { reason: 'signed-out' },
      () =>
        'Your Macro session expired. Sign in again to add this conversation.'
    )
    .with(
      { reason: 'unreachable' },
      () => "Couldn't reach Macro. Check your connection and try again."
    )
    .exhaustive();
}
