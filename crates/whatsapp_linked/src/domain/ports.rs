//! Capabilities the WhatsApp use cases need; the Postgres adapter implements
//! them. The provider-neutral ports (timeline, sends' generic side,
//! notifications) are `external_chat`'s.
//!
//! Repository methods that change state are atomic and re-check, under lock, the
//! facts their contract names. Methods that signal another process do it with
//! `NOTIFY` inside the same transaction, so a signal is never sent for a change
//! that did not commit.

use super::{events::*, jid::PhoneNumber, models::*};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use external_chat::domain::{
    models::*,
    ports::{ExternalChatResult, MutationTarget, SendIntent, StoredSend},
    timeline::view::People,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Owner-scoped account and pairing transitions.
#[async_trait]
pub trait AccountRepository: Send + Sync {
    /// The person's account, if they ever started pairing.
    async fn owned_account(&self, user: &MacroUserIdStr<'_>)
    -> ExternalChatResult<Option<Account>>;
    /// Return the live transaction, or start one: create the account if absent,
    /// otherwise move it to `pairing` and bump its generation. Fails with
    /// `Conflict` when the account is connected and `replace` is false. With
    /// `replace`, first ends the old consent exactly like
    /// [`AccountRepository::disconnect`] and drops the expected identity.
    /// Signals `whatsapp_pairing_requested`.
    async fn begin_pairing(
        &self,
        user: &MacroUserIdStr<'_>,
        replace: bool,
    ) -> ExternalChatResult<Pairing>;
    /// The owner's transaction with its current codes; an unconsumed transaction
    /// past its deadline is expired first (and its pairing account disconnected).
    /// `NotFound` for another user's transaction.
    async fn pair_state(
        &self,
        user: &MacroUserIdStr<'_>,
        pairing: Uuid,
    ) -> ExternalChatResult<PairState>;
    /// Store the owner's WebAuthn assertion for a live transaction waiting on a
    /// passkey; `NotFound` otherwise. Signals `whatsapp_pairing_requested`.
    async fn submit_passkey(
        &self,
        user: &MacroUserIdStr<'_>,
        pairing: Uuid,
        response: &serde_json::Value,
    ) -> ExternalChatResult<()>;
    /// Cancel the owner's live transaction and end the pairing consent.
    /// Signals `whatsapp_pairing_requested`. Idempotent.
    async fn cancel_pairing(
        &self,
        user: &MacroUserIdStr<'_>,
        pairing: Uuid,
    ) -> ExternalChatResult<()>;
    /// End consent at exactly this generation: state `disconnected`, generation
    /// + 1, memberships end, live pairings cancel, undispatched sends fail.
    /// Returns false when that generation was already disconnected.
    /// Signals `whatsapp_account_changed`.
    async fn disconnect(
        &self,
        user: &MacroUserIdStr<'_>,
        generation: i64,
    ) -> ExternalChatResult<bool>;
    /// The Macro user who linked this account.
    async fn account_owner(&self, account: Uuid) -> ExternalChatResult<Option<String>>;
    /// Delete participant receipts older than [`RECEIPT_RETENTION_DAYS`],
    /// pairings consumed over a day ago (they keep the expected identity) and
    /// lookups older than [`LOOKUP_WINDOW_MINUTES`].
    async fn expire_retained(&self) -> ExternalChatResult<u64>;
    /// Start asking whether `phone` has a WhatsApp account, for the connected
    /// account at its current generation (`Disconnected` otherwise). Returns
    /// the account's pending lookup of the same number when there is one;
    /// otherwise `RateLimited` once [`LOOKUP_LIMIT`] lookups started within
    /// [`LOOKUP_WINDOW_MINUTES`]. Signals `whatsapp_lookup_requested`.
    async fn begin_lookup(
        &self,
        account: &Account,
        phone: &PhoneNumber,
    ) -> ExternalChatResult<Lookup>;
    /// The account's lookup; one pending past [`LOOKUP_EXPIRY_SECONDS`] reads
    /// as `failed`. `NotFound` for another account's.
    async fn lookup(&self, account: Uuid, lookup: Uuid) -> ExternalChatResult<Lookup>;
    /// Start importing earlier messages of the owner's chats that wait for
    /// the phone or a message (`waiting_for_phone`/`waiting_for_message` →
    /// `pending`), for the connected account
    /// at its current generation (`Disconnected` otherwise). Returns how many
    /// started; signals `whatsapp_history_requested` when any did.
    async fn import_history(&self, account: &Account) -> ExternalChatResult<u32>;
}

/// An external chat bound to a remote chat, as one viewer can see it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VisibleAdoption {
    /// Remote chat id (WhatsApp JID).
    pub remote_id: String,
    /// External chat entity.
    pub id: Uuid,
    /// Display name.
    pub name: String,
    /// The person who added it.
    pub owner_id: String,
}

/// Group metadata kept current by the session service.
#[async_trait]
pub trait GroupRepository: Send + Sync {
    /// Groups the account has joined, as last observed.
    async fn account_groups(&self, account: Uuid) -> ExternalChatResult<Vec<GroupInfo>>;
    /// One joined group, as last observed.
    async fn account_group(
        &self,
        account: Uuid,
        group: &str,
    ) -> ExternalChatResult<Option<GroupInfo>>;
    /// Ask each account's replica to re-read its groups
    /// (`whatsapp_roster_requested`); the replica rate limits refreshes.
    async fn request_groups_refresh(&self, accounts: &[Uuid]) -> ExternalChatResult<()>;
    /// Accounts whose rosters describe a group entity: its observers, and the
    /// viewer's own connected account (a bot viewer has none).
    async fn group_accounts(&self, chat_id: Uuid, viewer: &str) -> ExternalChatResult<Vec<Uuid>>;
    /// Group entities bound to these remote groups that the person can see,
    /// newest first.
    async fn visible_adoptions(
        &self,
        user: &MacroUserIdStr<'_>,
        groups: &[String],
    ) -> ExternalChatResult<Vec<VisibleAdoption>>;
    /// Latest metadata for a chat's group from any account consenting to it,
    /// with names of people who wrote in it.
    async fn chat_roster(&self, chat: &ChatRef) -> ExternalChatResult<Option<GroupInfo>>;
    /// The account's own rosters of these groups, by group JID.
    async fn account_rosters(
        &self,
        account: Uuid,
        groups: &[String],
    ) -> ExternalChatResult<Vec<GroupInfo>>;
    /// The community each chat belongs to, from the newest roster any
    /// consenting observer read, in order.
    async fn communities(
        &self,
        chats: &[ChatRef],
    ) -> ExternalChatResult<Vec<Option<CommunityReference>>>;
    /// Names for WhatsApp ids in a chat: people seen in it first (their
    /// WhatsApp name and verified Macro user), then the owner's roster.
    async fn people(&self, chat: &ChatRef, jids: &[String]) -> ExternalChatResult<People>;

    /// The account's stored chat list (without the roster), newest first.
    async fn account_chats(&self, account: Uuid) -> ExternalChatResult<Vec<StoredChat>>;
}

/// One stored row of an account's chat list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredChat {
    /// Chat JID.
    pub jid: String,
    /// Group or direct.
    pub kind: ExternalChatKind,
    /// Name WhatsApp reported, if any.
    pub name: Option<String>,
    /// Newest activity.
    pub last_activity_at: Option<DateTime<Utc>>,
    /// Archived in WhatsApp.
    pub archived: bool,
    /// Pinned in WhatsApp.
    pub pinned: bool,
}

/// What the domain authorized adding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Adoption {
    /// The chat's JID.
    pub jid: String,
    /// Group or direct chat.
    pub kind: ExternalChatKind,
    /// Display name, following WhatsApp.
    pub name: String,
    /// The account may post now (always for a direct chat).
    pub can_post: bool,
    /// When the facts that authorized it were observed.
    pub observed_at: DateTime<Utc>,
}

/// A new external chat, authorized by the domain.
pub struct AdoptionRecord<'a> {
    /// Adopting person.
    pub user: &'a MacroUserIdStr<'a>,
    /// Their account at the generation that authorized adoption.
    pub account: &'a Account,
    /// What to add.
    pub adoption: &'a Adoption,
}

/// Result of adoption.
pub struct Adopted {
    /// The external chat.
    pub chat: ChatRef,
    /// Whether this call created the standalone entity.
    pub created: bool,
}

/// Adding WhatsApp chats as external chats, and detaching them.
#[async_trait]
pub trait AdoptionRepository: Send + Sync {
    /// Adopt atomically, serialized per person and remote group: one live group
    /// entity per (owner, remote group), owned by the caller. Records the
    /// caller-account's membership and signals its session service.
    async fn adopt(&self, record: AdoptionRecord<'_>) -> ExternalChatResult<Adopted>;
    /// Detach locally: end observing consents and fail undispatched sends.
    /// History stays. Signals `whatsapp_account_changed` for every observer.
    async fn detach(&self, chat: &ChatRef) -> ExternalChatResult<()>;
}

/// Durable send intents in the `whatsapp_send` outbox.
#[async_trait]
pub trait SendRepository: Send + Sync {
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
    /// Record the intent and assign the chat sequence. Replays with the same key
    /// return the stored progress; a different payload is a `Conflict`. Inserts
    /// only while the account is connected at its generation, the chat is
    /// active and the membership still observes. Signals `whatsapp_send_requested`.
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

/// Session-service state transitions, all fenced by the lease epoch.
#[async_trait]
pub trait SessionRepository: Send + Sync {
    /// The account's lifecycle, unfenced.
    async fn account_state(&self, account: Uuid) -> ExternalChatResult<Option<AccountState>>;
    /// Accounts needing a replica whose advisory lock
    /// (`hashtextextended('whatsapp-account:' || id, 0)`) nobody holds.
    async fn discoverable_accounts(&self, limit: i64) -> ExternalChatResult<Vec<Uuid>>;
    /// Fleet counts for health checks.
    async fn fleet_health(&self) -> ExternalChatResult<FleetHealth>;
    /// Store an inbound event for later ingestion, fenced; idempotent on id.
    async fn enqueue_inbound(
        &self,
        scope: SessionScope,
        event: &InboundEvent,
    ) -> ExternalChatResult<()>;
    /// Bump the lease epoch and recover the previous replica's sends: claimed but
    /// undispatched become `pending`; dispatched without outcome become `unknown`.
    async fn begin_lease(&self, account: Uuid) -> ExternalChatResult<Lease>;
    /// Return claimed but undispatched sends to `pending` before handing over.
    async fn release_lease(&self, scope: SessionScope) -> ExternalChatResult<()>;
    /// Tell other replicas the account is free to take while it still needs
    /// a session (`whatsapp_account_released`).
    async fn announce_released(&self, account: Uuid) -> ExternalChatResult<()>;
    /// Remove and return the owner's WebAuthn assertion, so it is forwarded once.
    async fn take_passkey_response(
        &self,
        scope: SessionScope,
        pairing: Uuid,
    ) -> ExternalChatResult<Option<serde_json::Value>>;
    /// Claim attachments this account observed and has not downloaded yet.
    async fn claim_media_imports(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<MediaImport>>;
    /// Keep downloaded bytes for import into a static file. The bytes must
    /// match the expected hash; a ready attachment is never rewritten.
    async fn complete_media_import(
        &self,
        scope: SessionScope,
        attachment: &AttachmentRef,
        bytes: &[u8],
    ) -> ExternalChatResult<()>;
    /// Record a failed download; a permanent failure or too many attempts marks
    /// the attachment failed and shows a notice on the message.
    async fn fail_media_import(
        &self,
        scope: SessionScope,
        attachment: &AttachmentRef,
        failure: MediaFailure,
    ) -> ExternalChatResult<()>;
    /// Bytes of the attachment of a send this replica claimed.
    async fn outbound_media(
        &self,
        scope: SessionScope,
        send: Uuid,
    ) -> ExternalChatResult<OutboundMedia>;
    /// A pairing transaction by id; expires it first when past its deadline.
    async fn pairing_work(&self, pairing: Uuid) -> ExternalChatResult<Option<PairingWork>>;
    /// The account's live pairing transaction, if any.
    async fn live_pairing(&self, scope: SessionScope) -> ExternalChatResult<Option<PairingWork>>;
    /// Apply progress to a live transaction. `Success` connects the account when
    /// the identity matches the expected one and belongs to no other account;
    /// otherwise the transaction fails with `Conflict` or `Forbidden`.
    async fn update_pairing(
        &self,
        scope: SessionScope,
        pairing: Uuid,
        update: &PairingUpdate,
    ) -> ExternalChatResult<PairingWork>;
    /// WhatsApp ended the session: `logged_out`, generation + 1, consents end,
    /// undispatched sends fail.
    async fn logged_out(&self, scope: SessionScope) -> ExternalChatResult<()>;
    /// Store group metadata and reconcile remote memberships of adopted
    /// bindings. With `complete`, groups not listed are treated as left.
    async fn update_groups(
        &self,
        scope: SessionScope,
        groups: &[GroupInfo],
        complete: bool,
    ) -> ExternalChatResult<()>;
    /// The account is no longer in this group (it left, was removed, or the
    /// group is gone): drop it from the account's list and end its membership.
    async fn group_left(
        &self,
        scope: SessionScope,
        group: &str,
        observed_at: DateTime<Utc>,
    ) -> ExternalChatResult<()>;
    /// Groups this account currently observes for at least one adopted binding.
    async fn observed_groups(&self, scope: SessionScope) -> ExternalChatResult<Vec<String>>;

    /// Upsert chat-list rows. Signals the owner's list when something changed.
    /// An added chat waiting for its first message that got one now waits for
    /// the owner to import (`waiting_for_phone`).
    async fn update_chats(
        &self,
        scope: SessionScope,
        chats: &[ChatUpdate],
    ) -> ExternalChatResult<()>;

    /// The account owner's groups still importing earlier messages.
    async fn backfill_work(&self, scope: SessionScope) -> ExternalChatResult<Vec<BackfillWork>>;

    /// Lookups waiting for this account's answer, started within
    /// [`LOOKUP_EXPIRY_SECONDS`].
    async fn pending_lookups(&self, scope: SessionScope) -> ExternalChatResult<Vec<LookupWork>>;

    /// Record WhatsApp's answer to a pending lookup; a found number's direct
    /// chat joins the chat list (named when given, never renamed by a lookup
    /// that has no name). Ignores a lookup that is no longer pending.
    /// Signals the owner's chat list.
    async fn complete_lookup(
        &self,
        scope: SessionScope,
        lookup: Uuid,
        answer: &LookupAnswer,
    ) -> ExternalChatResult<()>;

    /// No message of the chat is known to start from (`waiting_for_message`).
    async fn backfill_waiting_for_message(
        &self,
        scope: SessionScope,
        group: Uuid,
    ) -> ExternalChatResult<()>;

    /// A page was requested from the phone just now (`running`).
    async fn backfill_requested(&self, scope: SessionScope, group: Uuid) -> ExternalChatResult<()>;

    /// The phone did not answer the last request (`waiting_for_phone`).
    async fn backfill_unanswered(&self, scope: SessionScope, group: Uuid)
    -> ExternalChatResult<()>;

    /// Record a page the phone sent for a chat; returns the resulting state of
    /// each of the owner's groups for that chat that was importing.
    async fn backfill_page(
        &self,
        scope: SessionScope,
        page: &HistoryPage,
    ) -> ExternalChatResult<Vec<(Uuid, BackfillState)>>;
    /// Persist one validated event into every binding it is observed for.
    async fn ingest(
        &self,
        scope: SessionScope,
        event: &InboundEvent,
    ) -> ExternalChatResult<IngestOutcome>;
    /// Deferred events whose retry time has come.
    async fn due_events(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<InboundEvent>>;
    /// Claim pending sends in group order; expired ones fail instead.
    async fn claim_sends(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<ClaimedSend>>;
    /// Record that the request is about to be submitted with this message id,
    /// after re-checking every sending fact. After this returns, the send is
    /// never retried automatically.
    async fn begin_dispatch(
        &self,
        scope: SessionScope,
        send: Uuid,
        source_id: &str,
    ) -> ExternalChatResult<()>;
    /// Record the outcome; an acceptance also writes the group message.
    async fn record_send_outcome(
        &self,
        scope: SessionScope,
        send: Uuid,
        outcome: &SendOutcome,
    ) -> ExternalChatResult<()>;
}
