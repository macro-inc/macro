import type {
  SlackAccountState,
  SlackEndedReason,
} from '@service-storage/generated/schemas';
import { match } from 'ts-pattern';

/** One Slack workspace the person signed in to. */
export type SlackAccount = {
  id: string;
  teamId: string;
  teamName: string;
  /** `acme.slack.com`. */
  teamDomain: string;
  teamIconUrl: string | undefined;
  /** In an Enterprise Grid organization, whose admins can see the session. */
  enterprise: boolean;
  /** The person's Slack name in this workspace, once the session first ran. */
  displayName: string | undefined;
  state: SlackAccountState;
  endedReason: SlackEndedReason | undefined;
  /** Consent generation; fences a disconnect against a later sign-in. */
  generation: number;
};

/** What the Slack page shows for the person's accounts. */
export type AccountsView = {
  /** Workspaces syncing, or about to: their conversations are listed. */
  live: SlackAccount[];
  /** Workspaces whose session Slack ended: sign in again. */
  ended: SlackAccount[];
};

/** Disconnected workspaces drop out until the person signs in again. */
export function accountsView(accounts: readonly SlackAccount[]): AccountsView {
  return {
    live: accounts.filter(
      (account) =>
        account.state === 'connected' || account.state === 'connecting'
    ),
    ended: accounts.filter((account) => account.state === 'logged_out'),
  };
}

/** Why Slack ended a workspace's session, as the page's sentence. */
export function endedReasonMessage(
  teamName: string,
  reason: SlackEndedReason | undefined
): string {
  return match(reason)
    .with(
      'revoked',
      undefined,
      () =>
        `Your Slack session for ${teamName} ended (signed out, or revoked by an admin). Sign in again to keep syncing.`
    )
    .with(
      'expired',
      () =>
        `Your Slack session for ${teamName} expired. Sign in again to keep syncing.`
    )
    .with(
      'account_inactive',
      () =>
        `Your Slack account in ${teamName} was deactivated. Sign in again if it's back.`
    )
    .with(
      'team_disabled',
      () => `The ${teamName} workspace was disabled in Slack.`
    )
    .with(
      'removed_from_team',
      () => `You were removed from the ${teamName} workspace in Slack.`
    )
    .with(
      'enterprise_restricted',
      () =>
        `Your Slack admin blocks this kind of session for ${teamName}. Ask them to allow it, then sign in again.`
    )
    .with(
      'unreadable',
      () =>
        `Macro can no longer read your Slack session for ${teamName}. Sign in again to keep syncing.`
    )
    .exhaustive();
}

/** The workspace strip's state word. */
export function accountStateLabel(state: SlackAccountState): string {
  return match(state)
    .with('connected', () => 'Connected')
    .with('connecting', () => 'Connecting…')
    .with('logged_out', () => 'Session ended')
    .with('disconnected', () => 'Disconnected')
    .exhaustive();
}

/**
 * Why the owner can't reply in a Slack chat whose session ended, for the
 * chat's composer: "Your Acme session ended (…), so you can't reply."
 */
export function sessionEndedComposerNote(account: SlackAccount): string {
  return match(account.endedReason)
    .with(
      'enterprise_restricted',
      () =>
        `Your Slack admin blocks Macro in ${account.teamName}, so you can't reply.`
    )
    .otherwise(
      () =>
        `Your ${account.teamName} session ended (signed out or revoked by your admin), so you can't reply.`
    );
}
