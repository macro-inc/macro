//! What the account runner and the sign-in worker need from the outside: the
//! Slack session, and sealing secrets. Locks, the directory and the runner
//! contract are `session_fleet`'s.

use std::future::Future;

use slack_client::api::FileUpload;
use slack_client::login::{LoginError, LoginInput, LoginState, LoginStep};
use slack_client::models::Message;
use slack_client::realtime::RealtimeEvent;
use slack_client::{ChannelId, MessageTs, SessionCredentials, SlackError};
use slack_linked::domain::events::{BootFacts, Catalogue, StoredSecret};
use tokio::sync::mpsc;
use uuid::Uuid;

pub use session_fleet::ports::{AccountControl, AccountExit, AccountRunner, Traced};

/// A signal for one account this replica runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountSignal {
    /// `slack_account_changed`: consent or added chats changed; re-read.
    Changed,
    /// `slack_catalogue_requested`: refresh the Slack Connect catalogue.
    Catalogue,
    /// `slack_history_requested`: import earlier messages.
    History,
    /// `slack_send_requested`: claim pending sends.
    Send,
    /// `slack_read_requested`: send pending read marks.
    Read,
    /// Notifications may have been missed; re-read everything.
    Resync,
}

/// A session the runner holds, after `auth.test` and `client.userBoot`.
pub struct Connected<Session> {
    /// The session.
    pub session: Session,
    /// Who it is.
    pub boot: BootFacts,
    /// The websocket's events.
    pub events: mpsc::Receiver<RealtimeEvent>,
}

/// One page of a conversation's messages, newest first.
pub struct MessagePage {
    /// The messages.
    pub messages: Vec<Message>,
    /// Slack has older ones.
    pub has_more: bool,
}

/// A workspace session a sign-in produced, checked with `auth.test`.
pub struct ValidatedSession {
    /// Team.
    pub team_id: String,
    /// Enterprise.
    pub enterprise_id: Option<String>,
    /// Team name.
    pub team_name: String,
    /// Team subdomain.
    pub team_domain: String,
    /// Team icon.
    pub team_icon_url: Option<String>,
    /// The person's Slack user id there.
    pub slack_user_id: String,
}

/// Slack, for sign-in and for opening sessions.
pub trait SlackConnector: Send + Sync + 'static {
    /// An open session.
    type Session: SlackSession;

    /// Boot a session and open its websocket; the websocket stops when
    /// `stop` is cancelled.
    fn connect(
        &self,
        credentials: SessionCredentials,
        stop: tokio_util::sync::CancellationToken,
    ) -> impl Future<Output = Result<Connected<Self::Session>, SlackError>> + Send;

    /// Check a session with `auth.test` and name its workspace.
    fn validate(
        &self,
        credentials: &SessionCredentials,
    ) -> impl Future<Output = Result<ValidatedSession, SlackError>> + Send;

    /// One step of the email sign-in.
    fn login_step(
        &self,
        state: LoginState,
        input: LoginInput,
    ) -> impl Future<Output = Result<LoginStep, LoginError>> + Send;
}

/// One workspace session's Web API calls.
pub trait SlackSession: Send + Sync + 'static {
    /// The account's Slack Connect conversations, their teams and people.
    fn catalogue(&self) -> impl Future<Output = Result<Catalogue, SlackError>> + Send;

    /// Messages of a conversation after `oldest` and before `latest`.
    fn history(
        &self,
        conversation: &ChannelId,
        oldest: Option<&MessageTs>,
        latest: Option<&MessageTs>,
        limit: u16,
    ) -> impl Future<Output = Result<MessagePage, SlackError>> + Send;

    /// A thread's replies, without its root.
    fn replies(
        &self,
        conversation: &ChannelId,
        thread_ts: &MessageTs,
    ) -> impl Future<Output = Result<Vec<Message>, SlackError>> + Send;

    /// Post a message; returns its `ts`.
    fn post(
        &self,
        conversation: &ChannelId,
        text: &str,
        thread_ts: Option<&MessageTs>,
        client_msg_id: Uuid,
    ) -> impl Future<Output = Result<String, SlackError>> + Send;

    /// Edit one of the person's messages; returns the edit's `ts`.
    fn update(
        &self,
        conversation: &ChannelId,
        ts: &MessageTs,
        text: &str,
    ) -> impl Future<Output = Result<String, SlackError>> + Send;

    /// Delete one of the person's messages.
    fn delete(
        &self,
        conversation: &ChannelId,
        ts: &MessageTs,
    ) -> impl Future<Output = Result<(), SlackError>> + Send;

    /// Add (or remove) the person's reaction.
    fn react(
        &self,
        conversation: &ChannelId,
        ts: &MessageTs,
        name: &str,
        add: bool,
    ) -> impl Future<Output = Result<(), SlackError>> + Send;

    /// Move the person's read position in a conversation or thread.
    fn mark(
        &self,
        conversation: &ChannelId,
        thread_ts: Option<&MessageTs>,
        ts: &MessageTs,
    ) -> impl Future<Output = Result<(), SlackError>> + Send;

    /// Share a file in a conversation (or thread); returns the share
    /// message's `ts`.
    fn upload(
        &self,
        upload: &FileUpload,
    ) -> impl Future<Output = Result<String, SlackError>> + Send;

    /// A file's bytes (`files.info`, then the authenticated download).
    fn download(
        &self,
        file: &slack_client::FileId,
    ) -> impl Future<Output = Result<Vec<u8>, SlackError>> + Send;

    /// Sign the session out at Slack.
    fn sign_out(&self) -> impl Future<Output = Result<(), SlackError>> + Send;
}

/// Why a stored secret didn't open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenFailure {
    /// KMS is unavailable; retry later.
    Unavailable,
    /// It never will.
    Unreadable,
}

/// Sealing and opening the service's secrets (KMS).
pub trait Secrets: Send + Sync + 'static {
    /// An account's credentials.
    fn open_credentials(
        &self,
        user_id: &str,
        account: Uuid,
        secret: &StoredSecret,
    ) -> impl Future<Output = Result<SessionCredentials, OpenFailure>> + Send;

    /// Seal credentials for an account.
    fn seal_credentials(
        &self,
        user_id: &str,
        account: Uuid,
        credentials: &SessionCredentials,
    ) -> impl Future<Output = Result<StoredSecret, OpenFailure>> + Send;

    /// A pasted or captured session DSS sealed for an attempt.
    fn open_login_input(
        &self,
        user_id: &str,
        attempt: Uuid,
        secret: &StoredSecret,
    ) -> impl Future<Output = Result<Vec<u8>, OpenFailure>> + Send;

    /// A sign-in's private state.
    fn open_login_state(
        &self,
        user_id: &str,
        attempt: Uuid,
        secret: &StoredSecret,
    ) -> impl Future<Output = Result<Vec<u8>, OpenFailure>> + Send;

    /// Seal a sign-in's private state.
    fn seal_login_state(
        &self,
        user_id: &str,
        attempt: Uuid,
        state: &[u8],
    ) -> impl Future<Output = Result<StoredSecret, OpenFailure>> + Send;
}
