//! Accounts, sign-in attempts and the Slack Connect catalogue, as DSS and the
//! web app see them (`docs/architecture/slack-linked.md`). Added chats and
//! sends are `external_chat` models.

use chrono::{DateTime, Utc};
use external_chat::domain::models::{ChatReference, ExternalChatKind, SharedChatReference};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Account lifecycle. Websocket outages are not stored: a connected account
/// stays connected while its session service reconnects.
#[derive(
    Debug,
    Clone,
    Copy,
    Serialize,
    Deserialize,
    PartialEq,
    Eq,
    strum::IntoStaticStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackAccountState))]
#[strum(serialize_all = "snake_case")]
pub enum AccountState {
    /// Credentials stored; the session service has not booted it yet.
    Connecting,
    /// Booted at least once; consent is active.
    Connected,
    /// Slack ended the session ([`EndedReason`]); the owner must sign in again.
    LoggedOut,
    /// The owner disconnected.
    Disconnected,
}

impl AccountState {
    /// Consent is active: the session may be used and chats observed.
    pub fn is_active(self) -> bool {
        match self {
            Self::Connecting | Self::Connected => true,
            Self::LoggedOut | Self::Disconnected => false,
        }
    }
}

/// Why Slack ended a session.
#[derive(
    Debug,
    Clone,
    Copy,
    Serialize,
    Deserialize,
    PartialEq,
    Eq,
    strum::IntoStaticStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackEndedReason))]
#[strum(serialize_all = "snake_case")]
pub enum EndedReason {
    /// Signed out, or the token was revoked (`invalid_auth`, `not_authed`,
    /// `token_revoked`).
    Revoked,
    /// The workspace's session duration ran out (`token_expired`).
    Expired,
    /// The person's Slack account was deactivated.
    AccountInactive,
    /// The workspace was disabled.
    TeamDisabled,
    /// The person was removed from the workspace.
    RemovedFromTeam,
    /// The Enterprise Grid org blocks this kind of access.
    EnterpriseRestricted,
    /// The stored credentials can't be decrypted any more.
    Unreadable,
}

/// A person's Slack session in one workspace.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackAccount))]
pub struct Account {
    /// Stable account id.
    pub id: Uuid,
    /// The workspace.
    pub team_id: String,
    /// Workspace name.
    pub team_name: String,
    /// Workspace subdomain (`acme` of `acme.slack.com`).
    pub team_domain: String,
    /// Workspace icon.
    pub team_icon_url: Option<String>,
    /// Enterprise Grid org, whose admins can see the session.
    pub enterprise_id: Option<String>,
    /// The person's Slack user id, once the first boot ran.
    pub slack_user_id: Option<String>,
    /// The person's Slack display name, once the first boot ran.
    pub display_name: Option<String>,
    /// Lifecycle.
    pub state: AccountState,
    /// Why Slack ended the session, while `logged_out`.
    pub ended_reason: Option<EndedReason>,
    /// Consent generation; reconnecting the websocket never changes it.
    pub authorization_generation: i64,
    /// When the websocket last connected.
    pub last_connected_at: Option<DateTime<Utc>>,
}

/// The caller's Slack accounts, in any state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackAccounts))]
pub struct AccountList {
    /// Oldest first.
    pub accounts: Vec<Account>,
}

/// How a sign-in attempt started.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackSessionSource))]
pub enum SessionSource {
    /// The person pasted a token and cookie.
    Manual,
    /// The Macro desktop app captured the session after the person signed in
    /// on slack.com.
    Desktop,
}

/// Whether a workspace can be signed in to from Macro's servers.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackWorkspaceSignIn))]
pub enum WorkspaceSignIn {
    /// Signs in directly.
    Ready,
    /// Asks for a two-factor code first.
    TwoFactor,
    /// Requires SSO: finish on the desktop app.
    Sso,
}

/// A workspace the email signs in to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackLoginWorkspace))]
pub struct LoginWorkspace {
    /// The workspace.
    pub team_id: String,
    /// Its name.
    pub name: String,
    /// Its subdomain.
    pub domain: String,
    /// Its icon.
    pub icon_url: Option<String>,
    /// Its Enterprise Grid org's name: the org's admins see the session.
    pub enterprise_name: Option<String>,
    /// How it signs in.
    pub sign_in: WorkspaceSignIn,
    /// The caller already has a connected account for it.
    pub already_connected: bool,
}

/// Why a sign-in attempt failed.
#[derive(
    Debug,
    Clone,
    Copy,
    Serialize,
    Deserialize,
    PartialEq,
    Eq,
    strum::IntoStaticStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackLoginFailure))]
#[strum(serialize_all = "snake_case")]
pub enum LoginFailure {
    /// Slack rejected the email address.
    InvalidEmail,
    /// The email signs in to no workspace by email.
    NoWorkspaces,
    /// The emailed code expired; start again.
    CodeExpired,
    /// Slack is rate limiting sign-in; wait and start again.
    RateLimited,
    /// The two-factor session expired; start again.
    TwoFactorExpired,
    /// A pasted or captured session did not authenticate.
    InvalidSession,
    /// The attempt ran out of time.
    Expired,
    /// Slack could not be reached.
    SlackUnavailable,
}

/// Where a sign-in attempt is, and what the web shows for it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackLoginStep))]
pub enum LoginStep {
    /// A session replica is calling Slack; poll again.
    Working,
    /// Slack wants a captcha solved before it emails the code.
    #[serde(rename_all = "camelCase")]
    Captcha {
        /// The captcha's site key, for a client that can render it.
        site_key: String,
        /// The page the captcha belongs to.
        page_url: String,
        /// The previous solution was rejected.
        retry: bool,
    },
    /// Slack emailed a confirmation code.
    #[serde(rename_all = "camelCase")]
    EmailCode {
        /// Where it went.
        email: String,
        /// The previous code was wrong.
        retry: bool,
    },
    /// Pick the workspaces to connect.
    #[serde(rename_all = "camelCase")]
    PickWorkspaces {
        /// Every workspace the email signs in to.
        workspaces: Vec<LoginWorkspace>,
    },
    /// The workspace asks for a two-factor code.
    #[serde(rename_all = "camelCase")]
    TwoFactor {
        /// Which workspace.
        team: LoginWorkspace,
        /// The previous code was wrong.
        retry: bool,
    },
    /// The workspace requires SSO, which only the desktop app can finish.
    #[serde(rename_all = "camelCase")]
    FinishOnDesktop {
        /// Which workspace.
        team: LoginWorkspace,
        /// Slack's sign-in page for it.
        sign_in_url: String,
    },
    /// Signed in.
    #[serde(rename_all = "camelCase")]
    Done {
        /// Accounts created or reconnected.
        accounts: Vec<Account>,
        /// Chosen workspaces that need SSO and were not signed in.
        skipped: Vec<LoginWorkspace>,
    },
    /// Failed; start again.
    #[serde(rename_all = "camelCase")]
    Failed {
        /// Why.
        reason: LoginFailure,
    },
    /// The person cancelled.
    Cancelled,
}

impl LoginStep {
    /// The storage spelling of the step (`slack_login_attempt.step`).
    pub fn name(&self) -> LoginStepName {
        match self {
            Self::Working => LoginStepName::Working,
            Self::Captcha { .. } => LoginStepName::Captcha,
            Self::EmailCode { .. } => LoginStepName::EmailCode,
            Self::PickWorkspaces { .. } => LoginStepName::PickWorkspaces,
            Self::TwoFactor { .. } => LoginStepName::TwoFactor,
            Self::FinishOnDesktop { .. } => LoginStepName::FinishOnDesktop,
            Self::Done { .. } => LoginStepName::Done,
            Self::Failed { .. } => LoginStepName::Failed,
            Self::Cancelled => LoginStepName::Cancelled,
        }
    }
}

/// [`LoginStep`] without its data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString)]
#[strum(serialize_all = "snake_case")]
pub enum LoginStepName {
    /// [`LoginStep::Working`].
    Working,
    /// [`LoginStep::Captcha`].
    Captcha,
    /// [`LoginStep::EmailCode`].
    EmailCode,
    /// [`LoginStep::PickWorkspaces`].
    PickWorkspaces,
    /// [`LoginStep::TwoFactor`].
    TwoFactor,
    /// [`LoginStep::FinishOnDesktop`].
    FinishOnDesktop,
    /// [`LoginStep::Done`].
    Done,
    /// [`LoginStep::Failed`].
    Failed,
    /// [`LoginStep::Cancelled`].
    Cancelled,
}

impl LoginStepName {
    /// The attempt is over; it takes no more input.
    pub fn is_final(self) -> bool {
        match self {
            Self::Done | Self::Failed | Self::Cancelled => true,
            Self::Working
            | Self::Captcha
            | Self::EmailCode
            | Self::PickWorkspaces
            | Self::TwoFactor
            | Self::FinishOnDesktop => false,
        }
    }
}

/// A sign-in attempt, as `GET /slack/login/{id}` returns it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackLogin))]
pub struct Login {
    /// Poll `GET /slack/login/{id}` with it.
    pub id: Uuid,
    /// Where it is.
    pub step: LoginStep,
    /// When it stops taking input.
    pub expires_at: DateTime<Utc>,
}

/// One-time input a step takes, stored in plaintext until a replica consumes
/// it (`slack_login_attempt.input`). Never logged.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LoginInput {
    /// Start an email sign-in.
    Email {
        /// The address.
        email: String,
    },
    /// The captcha's solution.
    Captcha {
        /// What the captcha widget returned.
        solution: String,
    },
    /// The emailed confirmation code, without its dash.
    Code {
        /// Six letters and digits.
        code: String,
    },
    /// The workspaces to sign in to.
    Workspaces {
        /// Their team ids.
        team_ids: Vec<String>,
    },
    /// A two-factor code.
    TwoFactor {
        /// Six digits.
        code: String,
    },
    /// A pasted or captured session; its secrets are in `sealed_input`.
    Session {
        /// Where it came from.
        source: SessionSource,
    },
}

impl std::fmt::Debug for LoginInput {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let kind = match self {
            Self::Email { .. } => "email",
            Self::Captcha { .. } => "captcha",
            Self::Code { .. } => "code",
            Self::Workspaces { .. } => "workspaces",
            Self::TwoFactor { .. } => "two_factor",
            Self::Session { .. } => "session",
        };
        formatter
            .debug_struct("LoginInput")
            .field("kind", &kind)
            .finish_non_exhaustive()
    }
}

/// One workspace token of a pasted or captured session.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackSessionToken))]
pub struct SessionTokenInput {
    /// The `xoxc-` token.
    pub token: String,
    /// The workspace it belongs to, when the client knows it.
    pub team_id: Option<String>,
}

/// A pasted or captured session, as DSS receives it and seals it at once.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackSessionSubmission))]
pub struct SessionSubmission {
    /// Pasted or captured by the desktop app.
    pub source: SessionSource,
    /// The `d` cookie.
    pub cookie: String,
    /// The `d-s` cookie, when the client has it.
    pub cookie_ds: Option<String>,
    /// One token per workspace.
    pub tokens: Vec<SessionTokenInput>,
}

impl std::fmt::Debug for SessionSubmission {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SessionSubmission")
            .field("source", &self.source)
            .field("tokens", &self.tokens.len())
            .finish_non_exhaustive()
    }
}

/// A Slack team as the catalogue names it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackTeam))]
pub struct Team {
    /// Its id.
    pub team_id: String,
    /// Its name; the id when Slack never told us.
    pub name: String,
    /// Its subdomain.
    pub domain: Option<String>,
    /// Its icon.
    pub icon_url: Option<String>,
}

/// A Slack user as the catalogue names them.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackPerson))]
pub struct Person {
    /// Their id.
    pub slack_user_id: String,
    /// Display name, else real name, else the id.
    pub name: String,
    /// Their avatar.
    pub avatar_url: Option<String>,
    /// Their organization.
    pub team: Option<Team>,
}

/// Why a catalogue conversation can't be added.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackCannotAdd))]
pub enum CannotAddReason {
    /// Archived in Slack.
    Archived,
    /// Disconnected from the other organization.
    Frozen,
    /// The person isn't in it.
    NotMember,
}

/// One Slack Connect conversation of the caller's accounts.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackConversation))]
pub struct Conversation {
    /// Slack's conversation id; `POST /external-chats {provider: "slack",
    /// remoteId, kind}` adds it.
    pub remote_id: String,
    /// Channel or group DM (`group`), or a one-to-one DM (`direct`).
    pub kind: ExternalChatKind,
    /// `#name` for a channel; the other person's name for a DM.
    pub name: String,
    /// The channel topic.
    pub topic: Option<String>,
    /// A private channel.
    pub is_private: bool,
    /// Archived in Slack.
    pub is_archived: bool,
    /// Disconnected from the other organization: read-only.
    pub frozen: bool,
    /// The other organizations.
    pub connected_teams: Vec<Team>,
    /// A DM's other person.
    pub direct_person: Option<Person>,
    /// The caller's account ids that see it.
    pub accounts: Vec<Uuid>,
    /// Newest activity.
    pub last_activity_at: Option<DateTime<Utc>>,
    /// Unread messages in Slack.
    pub unread_count: u32,
    /// The caller's own external chat for it.
    pub added: Option<ChatReference>,
    /// Someone else's, shared with the caller.
    pub shared: Option<SharedChatReference>,
    /// "Add to Macro" works now.
    pub can_add: bool,
    /// Why it can't be added.
    pub cannot_add_reason: Option<CannotAddReason>,
}

/// The caller's Slack Connect catalogue.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackConversationList))]
pub struct ConversationList {
    /// Newest activity first.
    pub conversations: Vec<Conversation>,
    /// A refresh was requested; refetch on `external_chat_changed`.
    pub refreshing: bool,
}

/// Where a chat's history import is.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SlackHistoryImport))]
pub struct HistoryImport {
    /// Started importing another page of earlier messages.
    pub started: bool,
}

/// How long a sign-in attempt takes input.
pub const LOGIN_TTL_MINUTES: i32 = 10;
/// Messages imported when a chat is added, and per further import.
pub const BACKFILL_MESSAGE_LIMIT: i32 = 1000;
/// Days of history imported when a chat is added.
pub const BACKFILL_MAX_AGE_DAYS: i32 = 90;
/// Most people one text send may @-mention.
pub const MENTION_LIMIT: usize = 64;
/// Unattempted intents expire this long after they were created.
pub const SEND_EXPIRY_SECONDS: i64 = 10 * 60;
/// Least time between two catalogue refreshes of one account.
pub const CATALOGUE_REFRESH_SECONDS: i32 = 30;
/// Most workspaces one sign-in connects.
pub const LOGIN_WORKSPACE_LIMIT: usize = 20;
