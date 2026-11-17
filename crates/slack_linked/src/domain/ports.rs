//! Capabilities the DSS-side Slack use cases need; the Postgres and KMS
//! adapters implement them. The provider-neutral ports are `external_chat`'s.
//!
//! Repository methods that change state are atomic and re-check, under lock,
//! the facts their contract names. Methods that signal the session service do
//! it with `NOTIFY` inside the same transaction.

// `Arc<dyn …>` at the composition root, like `external_chat`'s ports.
use super::models::*;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use external_chat::domain::{
    models::*,
    ports::{ExternalChatResult, MutationTarget, SendIntent, StoredSend},
    timeline::view::People,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// A blob sealed under a fresh KMS data key, ready for its columns.
pub struct SealedBlob {
    /// `kms_envelope` blob: `0x01 | nonce | ciphertext`.
    pub ciphertext: Vec<u8>,
    /// The data key, wrapped by KMS.
    pub data_key: Vec<u8>,
    /// The KMS key that wrapped it.
    pub kms_key_id: String,
    /// The sealing scheme.
    pub encryption_version: i16,
}

/// Seals a pasted or captured session in DSS, which can never open it again
/// (`GenerateDataKey` only, purpose `slack-login-input`).
#[async_trait]
pub trait LoginInputSealer: Send + Sync {
    /// Seal `submission` for the attempt `attempt` of `user`.
    async fn seal(
        &self,
        user: &MacroUserIdStr<'_>,
        attempt: Uuid,
        submission: &SessionSubmission,
    ) -> ExternalChatResult<SealedBlob>;
}

/// What a new sign-in attempt starts with.
pub enum LoginStart {
    /// An email address.
    Email {
        /// The address.
        email: String,
    },
    /// A pasted or captured session, already sealed.
    Session {
        /// The attempt id the blob was sealed for.
        attempt: Uuid,
        /// Pasted or captured.
        source: SessionSource,
        /// The sealed submission.
        sealed: SealedBlob,
    },
}

/// Sign-in attempts, as DSS records them.
#[async_trait]
pub trait LoginRepository: Send + Sync {
    /// Cancel the person's open attempt, create a new one in `working` with
    /// its input, and signal `slack_login_requested`.
    async fn begin_login(
        &self,
        user: &MacroUserIdStr<'_>,
        start: LoginStart,
    ) -> ExternalChatResult<Login>;
    /// The person's attempt; one past its deadline reads `failed: expired`.
    /// `NotFound` for another person's.
    async fn login(&self, user: &MacroUserIdStr<'_>, attempt: Uuid) -> ExternalChatResult<Login>;
    /// Store `input` for the step the attempt is waiting in, move it to
    /// `working` and signal. `Conflict` unless the attempt is live and in
    /// `expected`.
    async fn submit_login_input(
        &self,
        user: &MacroUserIdStr<'_>,
        attempt: Uuid,
        expected: LoginStepName,
        input: LoginInput,
    ) -> ExternalChatResult<Login>;
    /// Cancel a live attempt and drop its secrets. Idempotent.
    async fn cancel_login(
        &self,
        user: &MacroUserIdStr<'_>,
        attempt: Uuid,
    ) -> ExternalChatResult<Login>;
}

/// Owner-scoped accounts.
#[async_trait]
pub trait AccountRepository: Send + Sync {
    /// The person's accounts, oldest first.
    async fn accounts(&self, user: &MacroUserIdStr<'_>) -> ExternalChatResult<Vec<Account>>;
    /// The Macro user who signed this account in.
    async fn account_owner(&self, account: Uuid) -> ExternalChatResult<Option<String>>;
    /// Accounts Slack logged out whose owner hasn't been told yet.
    async fn ended_accounts(&self, limit: i64) -> ExternalChatResult<Vec<EndedAccount>>;
    /// The owner was told this generation ended.
    async fn ended_notified(&self, account: Uuid, generation: i64) -> ExternalChatResult<()>;
    /// End consent at exactly this generation: state `disconnected`,
    /// generation + 1, credentials wiped unless `sign_out` asks the replica
    /// to sign out first, memberships end, undispatched sends fail. Returns
    /// false when that generation was already over. Signals
    /// `slack_account_changed`.
    async fn disconnect(
        &self,
        user: &MacroUserIdStr<'_>,
        account: Uuid,
        generation: i64,
        sign_out: bool,
    ) -> ExternalChatResult<bool>;
    /// Start importing another page of a chat's earlier messages from the
    /// owner's connected account observing it. Returns false when there is
    /// nothing older or an import is already running. Signals
    /// `slack_history_requested`.
    async fn import_history(
        &self,
        user: &MacroUserIdStr<'_>,
        chat: Uuid,
    ) -> ExternalChatResult<bool>;
}

/// An account Slack logged out, to tell its owner about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EndedAccount {
    /// The account.
    pub account_id: Uuid,
    /// Its owner.
    pub user_id: String,
    /// Its workspace's name.
    pub team_name: String,
    /// Why.
    pub reason: EndedReason,
    /// The ended generation.
    pub generation: i64,
}

/// One catalogue row of one of the person's accounts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogueEntry {
    /// The account that sees it.
    pub account_id: Uuid,
    /// Slack's conversation id.
    pub conversation_id: String,
    /// Channel or DM.
    pub kind: ExternalChatKind,
    /// Name as Slack gives it (without `#`).
    pub name: String,
    /// Topic.
    pub topic: Option<String>,
    /// Private channel.
    pub is_private: bool,
    /// Archived.
    pub is_archived: bool,
    /// The person is in it.
    pub is_member: bool,
    /// Slack's frozen reason, when frozen.
    pub frozen_reason: Option<String>,
    /// The other organizations.
    pub connected_teams: Vec<Team>,
    /// A DM's other person.
    pub direct_person: Option<Person>,
    /// Newest activity.
    pub last_activity_at: Option<DateTime<Utc>>,
    /// Unread in Slack.
    pub unread_count: u32,
}

/// An external chat bound to a Slack conversation, as one viewer can see it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VisibleAdoption {
    /// Slack conversation id.
    pub remote_id: String,
    /// External chat entity.
    pub id: Uuid,
    /// Display name.
    pub name: String,
    /// The person who added it.
    pub owner_id: String,
    /// One of the owner's active accounts observes it; after a disconnect or
    /// a session end it doesn't, until they add it again.
    pub observed: bool,
}

/// The catalogue the session service keeps.
#[async_trait]
pub trait CatalogueRepository: Send + Sync {
    /// Every catalogue row of the person's active accounts.
    async fn catalogue(&self, user: &MacroUserIdStr<'_>)
    -> ExternalChatResult<Vec<CatalogueEntry>>;
    /// Ask these accounts' replicas to refresh (`slack_catalogue_requested`);
    /// returns whether any was asked (the last refresh is older than
    /// [`CATALOGUE_REFRESH_SECONDS`]).
    async fn request_catalogue_refresh(&self, accounts: &[Uuid]) -> ExternalChatResult<bool>;
    /// External chats bound to these conversations that the person can see,
    /// newest first.
    async fn visible_adoptions(
        &self,
        user: &MacroUserIdStr<'_>,
        conversations: &[String],
    ) -> ExternalChatResult<Vec<VisibleAdoption>>;
    /// The accounts observing a chat, and the viewer's own active accounts.
    async fn chat_accounts(&self, chat: Uuid, viewer: &str) -> ExternalChatResult<Vec<Uuid>>;
    /// Who is in a chat, from the newest catalogue row of an observing
    /// account and the people who wrote in it.
    async fn members(&self, chat: &ChatRef) -> ExternalChatResult<Option<ChatMembers>>;
    /// Names for Slack user ids and stored people of a chat.
    async fn people(
        &self,
        chat: &ChatRef,
        ids: &[String],
        persons: &[Uuid],
    ) -> ExternalChatResult<People>;
    /// Each chat's sending facts for the person, in order: whether one of
    /// their active accounts observes it at that account's generation, and
    /// whether that account's catalogue row lets it post (a member, not
    /// archived or frozen).
    async fn sending_facts(
        &self,
        user_id: &str,
        chats: &[ChatRef],
    ) -> ExternalChatResult<Vec<(bool, bool)>>;
}

/// Who is in a chat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatMembers {
    /// The conversation's name.
    pub name: String,
    /// People seen in it, with their organizations.
    pub people: Vec<Person>,
    /// When the observing account last read it.
    pub observed_at: DateTime<Utc>,
}

/// What the domain authorized adding.
pub struct AdoptionRecord<'a> {
    /// Adopting person.
    pub user: &'a MacroUserIdStr<'a>,
    /// The conversation.
    pub conversation_id: &'a str,
    /// Channel or DM.
    pub kind: ExternalChatKind,
    /// Display name.
    pub name: &'a str,
    /// The person's active accounts that see it, each at its generation.
    pub accounts: &'a [(Uuid, i64)],
}

/// Result of adoption.
pub struct Adopted {
    /// The external chat.
    pub chat: ChatRef,
    /// Whether this call created it.
    pub created: bool,
}

/// Adding Slack conversations as external chats, and detaching them.
#[async_trait]
pub trait AdoptionRepository: Send + Sync {
    /// Adopt atomically: one live chat per (owner, conversation). Records a
    /// membership per account (memberships of a re-add are renewed), starts
    /// the history import and signals each account's replica.
    async fn adopt(&self, record: AdoptionRecord<'_>) -> ExternalChatResult<Adopted>;
    /// End observing consents and fail undispatched sends; history stays.
    /// Signals `slack_account_changed` for every observer.
    async fn detach(&self, chat: &ChatRef) -> ExternalChatResult<()>;
}

/// Durable send intents in the `slack_send` outbox, and read marks for Slack.
#[async_trait]
pub trait SendRepository: Send + Sync {
    /// Queue the owner's read position for each observing account of theirs
    /// (`slack_read_mark`, newest wins) and signal `slack_read_requested`.
    async fn queue_read_mark(
        &self,
        chat: &ChatRef,
        read: &external_chat::domain::timeline::ReadAdvance,
    ) -> ExternalChatResult<()>;
    /// The source of a message in this chat, for quotes and mutations.
    async fn mutation_target(
        &self,
        chat: &ChatRef,
        message: Uuid,
    ) -> ExternalChatResult<Option<MutationTarget>>;
    /// The person's earlier send with this intent key in the chat.
    async fn stored_send(
        &self,
        chat_id: Uuid,
        user: &MacroUserIdStr<'_>,
        idempotency_key: Uuid,
    ) -> ExternalChatResult<Option<StoredSend>>;
    /// Record the intent from the account of the chat's membership that last
    /// connected. See [`external_chat::domain::ports::ChatProvider::enqueue_send`].
    /// Signals `slack_send_requested`.
    async fn enqueue(&self, intent: SendIntent<'_>) -> ExternalChatResult<SendProgress>;
    /// The person's sends in a chat that are not yet accepted, newest first.
    async fn open_sends(
        &self,
        chat_id: Uuid,
        user: &MacroUserIdStr<'_>,
    ) -> ExternalChatResult<Vec<SendProgress>>;
    /// The person's sends for these chat messages or intent ids.
    async fn sends_for(
        &self,
        chat_id: Uuid,
        user: &MacroUserIdStr<'_>,
        ids: &[Uuid],
    ) -> ExternalChatResult<Vec<SendProgress>>;
    /// The state of the viewer's newest send of each of these messages.
    async fn delivery_states(
        &self,
        chat_id: Uuid,
        viewer: &str,
        messages: &[Uuid],
    ) -> ExternalChatResult<Vec<(Uuid, DeliveryState)>>;
}

/// The session service's storage: every write is fenced by the caller's
/// [`super::events::SessionScope`] (`Fenced` once another replica took over).
#[async_trait]
pub trait SessionRepository: Send + Sync {
    /// Accounts that need a replica: active, or disconnected with a pending
    /// sign-out, whose advisory lock
    /// (`hashtextextended('slack-account:' || id, 0)`) nobody holds.
    async fn discoverable_accounts(&self, limit: i64) -> ExternalChatResult<Vec<Uuid>>;
    /// Accounts that need a replica and that none holds, and the age in
    /// seconds of the oldest queued change.
    async fn fleet_health(&self) -> ExternalChatResult<(u64, u64)>;
    /// Take the account: bump its lease epoch, record the previous replica's
    /// in-flight sends as `unknown`.
    async fn begin_lease(&self, account: Uuid) -> ExternalChatResult<super::events::Lease>;
    /// Hand the account over: undispatched claims return to `pending`.
    async fn release_lease(&self, scope: super::events::SessionScope) -> ExternalChatResult<()>;
    /// Signal `slack_account_released`.
    async fn announce_released(&self, account: Uuid) -> ExternalChatResult<()>;
    /// The account booted: record who it is, `connected`.
    async fn connected(
        &self,
        scope: super::events::SessionScope,
        facts: &super::events::BootFacts,
    ) -> ExternalChatResult<()>;
    /// Slack ended the session: `logged_out` with `reason`, generation + 1,
    /// credentials wiped, memberships end, undispatched sends fail.
    async fn session_ended(
        &self,
        scope: super::events::SessionScope,
        reason: EndedReason,
    ) -> ExternalChatResult<()>;
    /// A requested sign-out ran (or failed for good): wipe the credentials.
    async fn signed_out(&self, scope: super::events::SessionScope) -> ExternalChatResult<()>;
    /// Replace the account's catalogue with what Slack listed.
    async fn replace_catalogue(
        &self,
        scope: super::events::SessionScope,
        catalogue: &super::events::Catalogue,
    ) -> ExternalChatResult<()>;
    /// The account's lifecycle state and consent generation.
    async fn consent(
        &self,
        scope: super::events::SessionScope,
    ) -> ExternalChatResult<(super::models::AccountState, i64)>;
    /// The added chats the account observes, with their sync cursors.
    async fn observed_chats(
        &self,
        scope: super::events::SessionScope,
    ) -> ExternalChatResult<Vec<super::events::ObservedChat>>;
    /// Persist a change before acting on it; `Backlogged` when too many wait.
    async fn enqueue_inbound(
        &self,
        scope: super::events::SessionScope,
        change: &super::events::InboundChange,
    ) -> ExternalChatResult<Uuid>;
    /// The account's queued changes, oldest first.
    async fn queued_inbound(
        &self,
        scope: super::events::SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<super::events::QueuedInbound>>;
    /// Store one change into every added chat of the account it belongs to,
    /// then drop its queue row (`Deferred` keeps it for a later retry).
    async fn ingest(
        &self,
        scope: super::events::SessionScope,
        queued: Uuid,
        change: &super::events::InboundChange,
    ) -> ExternalChatResult<super::events::Ingested>;
    /// Claim the account's pending file downloads (for five minutes).
    async fn claim_media(
        &self,
        scope: super::events::SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<super::events::MediaImport>>;
    /// A download finished: stage the bytes and signal DSS to import them.
    async fn complete_media(
        &self,
        scope: super::events::SessionScope,
        attachment: &AttachmentRef,
        bytes: &[u8],
    ) -> ExternalChatResult<()>;
    /// A download failed: retry with backoff, or show it unavailable.
    async fn fail_media(
        &self,
        scope: super::events::SessionScope,
        attachment: &AttachmentRef,
        failure: super::events::MediaFailure,
    ) -> ExternalChatResult<()>;
    /// Claim pending sends of the account, in chat order.
    async fn claim_sends(
        &self,
        scope: super::events::SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<super::events::ClaimedSend>>;
    /// The staged file of a claimed file send.
    async fn outbound_file(
        &self,
        scope: super::events::SessionScope,
        send: Uuid,
    ) -> ExternalChatResult<super::events::OutboundFile>;
    /// The point of no return: re-check every fact and record the
    /// `client_msg_id`. `false` means the send failed or expired instead.
    async fn begin_dispatch(
        &self,
        scope: super::events::SessionScope,
        send: Uuid,
        client_msg_id: &str,
    ) -> ExternalChatResult<bool>;
    /// Record how a dispatched send ended.
    async fn record_send_outcome(
        &self,
        scope: super::events::SessionScope,
        send: Uuid,
        outcome: &super::events::SendOutcome,
    ) -> ExternalChatResult<()>;
    /// Read marks waiting to go to Slack.
    async fn pending_read_marks(
        &self,
        scope: super::events::SessionScope,
    ) -> ExternalChatResult<Vec<super::events::ReadMark>>;
    /// A read mark reached Slack (or can't): drop it unless a newer one
    /// replaced it.
    async fn read_mark_done(
        &self,
        scope: super::events::SessionScope,
        mark: &super::events::ReadMark,
    ) -> ExternalChatResult<()>;
    /// Chats of the account with a history import to run.
    async fn history_work(
        &self,
        scope: super::events::SessionScope,
    ) -> ExternalChatResult<Vec<super::events::HistoryWork>>;
    /// A history page was stored: move the cursor; `done` when Slack has
    /// nothing older, else `partial` once the run's limit is reached.
    async fn history_page(
        &self,
        scope: super::events::SessionScope,
        chat: Uuid,
        oldest_ts: Option<&str>,
        imported: i32,
        exhausted: bool,
    ) -> ExternalChatResult<()>;
    /// Claim a sign-in attempt that has input (for a minute).
    async fn claim_login(
        &self,
        attempt: Uuid,
    ) -> ExternalChatResult<Option<super::events::LoginWork>>;
    /// Attempts with input no replica claimed (missed signals).
    async fn waiting_logins(&self, limit: i64) -> ExternalChatResult<Vec<Uuid>>;
    /// The teams the person has an active account for.
    async fn connected_teams(&self, user_id: &str) -> ExternalChatResult<Vec<String>>;
    /// The person's account id for a team: the existing one, else a new id
    /// to seal credentials for.
    async fn account_id_for(&self, user_id: &str, team_id: &str) -> ExternalChatResult<Uuid>;
    /// Move a claimed attempt on. `Done` creates or reconnects the accounts
    /// (generation + 1, `connecting`) and signals `slack_account_changed`;
    /// every outcome drops the consumed input.
    async fn advance_login(
        &self,
        attempt: Uuid,
        advance: &super::events::LoginAdvance,
    ) -> ExternalChatResult<()>;
}
