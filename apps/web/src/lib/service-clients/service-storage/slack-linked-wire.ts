/**
 * DSS's `/slack` wire types, hand-typed from
 * `docs/architecture/slack-linked.md` until `crates/slack_linked` is in the
 * generated schemas. Replace each with its `./generated/schemas` export then,
 * and delete this file.
 */
import type { ExternalChatKind } from './generated/schemas/externalChatKind';

export type SlackLoginWorkspace = {
  teamId: string;
  name: string;
  domain: string;
  iconUrl: string | null;
  /** Enterprise Grid: the organization's admins can see the session. */
  enterpriseName: string | null;
  signIn: 'ready' | 'two_factor' | 'sso';
  alreadyConnected: boolean;
};

export type SlackLoginFailure =
  | 'invalid_email'
  | 'no_workspaces'
  | 'code_expired'
  | 'rate_limited'
  | 'two_factor_expired'
  | 'invalid_session'
  | 'expired'
  | 'slack_unavailable';

export type SlackAccountState =
  | 'connecting'
  | 'connected'
  | 'logged_out'
  | 'disconnected';

export type SlackEndedReason =
  | 'revoked'
  | 'expired'
  | 'account_inactive'
  | 'team_disabled'
  | 'removed_from_team'
  | 'enterprise_restricted'
  | 'unreadable';

export type SlackAccount = {
  id: string;
  teamId: string;
  teamName: string;
  teamDomain: string;
  teamIconUrl: string | null;
  enterpriseId: string | null;
  slackUserId: string | null;
  displayName: string | null;
  state: SlackAccountState;
  endedReason: SlackEndedReason | null;
  authorizationGeneration: number;
  lastConnectedAt: string | null;
};

export type SlackLoginStep =
  | { kind: 'working' }
  | { kind: 'captcha'; siteKey: string; pageUrl: string; retry: boolean }
  | { kind: 'email_code'; email: string; retry: boolean }
  | { kind: 'pick_workspaces'; workspaces: SlackLoginWorkspace[] }
  | { kind: 'two_factor'; team: SlackLoginWorkspace; retry: boolean }
  | {
      kind: 'finish_on_desktop';
      team: SlackLoginWorkspace;
      signInUrl: string;
    }
  | {
      kind: 'done';
      accounts: SlackAccount[];
      skipped: SlackLoginWorkspace[];
    }
  | { kind: 'failed'; reason: SlackLoginFailure }
  | { kind: 'cancelled' };

export type SlackLogin = {
  id: string;
  step: SlackLoginStep;
  expiresAt: string;
};

/** A session to sign in with: pasted, or captured by Macro desktop. */
export type SlackSessionLoginRequest = {
  source: 'manual' | 'desktop';
  cookie: string;
  cookieDs?: string;
  tokens: { token: string; teamId?: string }[];
};

export type SlackAccountDisconnectRequest = {
  authorizationGeneration: number;
  signOut: boolean;
};

export type SlackTeam = {
  teamId: string;
  name: string;
  domain: string | null;
  iconUrl: string | null;
};

export type SlackPerson = {
  slackUserId: string;
  name: string;
  avatarUrl: string | null;
  team: SlackTeam | null;
};

export type SlackChatReference = { id: string };
export type SlackSharedChatReference = { id: string; ownerId: string };

export type SlackConversation = {
  remoteId: string;
  kind: ExternalChatKind;
  name: string;
  topic: string | null;
  isPrivate: boolean;
  isArchived: boolean;
  frozen: boolean;
  connectedTeams: SlackTeam[];
  directPerson: SlackPerson | null;
  accounts: string[];
  lastActivityAt: string | null;
  unreadCount: number;
  added: SlackChatReference | null;
  shared: SlackSharedChatReference | null;
  canAdd: boolean;
  cannotAddReason: 'archived' | 'frozen' | 'not_member' | null;
};

export type SlackConversationList = {
  conversations: SlackConversation[];
  refreshing: boolean;
};

export type SlackHistoryImport = {
  state: 'running' | 'done' | 'partial';
};

/** `POST /external-chats` for a Slack conversation. */
export type SlackChatAdd = {
  provider: 'slack';
  remoteId: string;
  kind: ExternalChatKind;
};
