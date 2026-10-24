//! Capabilities the linked-device use cases need. Postgres adapters implement
//! the repositories; DSS supplies the authorizer and group notification publisher.
//!
//! Repository methods that change state are atomic and re-check, under lock, the
//! facts their contract names. Methods that signal another process do it with
//! `NOTIFY` inside the same transaction, so a signal is never sent for a change
//! that did not commit.

use super::{events::*, models::*};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Result of every port and service call.
pub type LinkedResult<T> = Result<T, rootcause::Report<LinkedError>>;

/// Shared request budget for deliberate sends, keyed by authenticated person.
#[async_trait]
pub trait SendRateLimiter: Send + Sync {
    /// Consume one request across all groups and service replicas. Requests
    /// rejected later still count; infrastructure failure must fail closed.
    async fn check(&self, user: &str) -> LinkedResult<()>;
}

/// Owner-scoped account and pairing transitions.
#[async_trait]
pub trait AccountRepository: Send + Sync {
    /// The person's account, if they ever started pairing.
    async fn owned_account(&self, user: &str) -> LinkedResult<Option<Account>>;
    /// Return the live transaction, or start one: create the account if absent,
    /// otherwise move it to `pairing` and bump its generation. Fails with
    /// `Conflict` when the account is connected and `replace` is false. With
    /// `replace`, first ends the old consent exactly like
    /// [`AccountRepository::disconnect`] and drops the expected identity.
    /// Signals `whatsapp_pairing_requested`.
    async fn begin_pairing(&self, user: &str, replace: bool) -> LinkedResult<Pairing>;
    /// The owner's transaction with its current codes; an unconsumed transaction
    /// past its deadline is expired first (and its pairing account disconnected).
    /// `NotFound` for another user's transaction.
    async fn pair_state(&self, user: &str, pairing: Uuid) -> LinkedResult<PairState>;
    /// Store the owner's WebAuthn assertion for a live transaction waiting on a
    /// passkey; `NotFound` otherwise. Signals `whatsapp_pairing_requested`.
    async fn submit_passkey(
        &self,
        user: &str,
        pairing: Uuid,
        response: &serde_json::Value,
    ) -> LinkedResult<()>;
    /// Cancel the owner's live transaction and end the pairing consent.
    /// Signals `whatsapp_pairing_requested`. Idempotent.
    async fn cancel_pairing(&self, user: &str, pairing: Uuid) -> LinkedResult<()>;
    /// End consent at exactly this generation: state `disconnected`, generation
    /// + 1, memberships end, live pairings cancel, undispatched sends fail.
    /// Returns false when that generation was already disconnected.
    /// Signals `whatsapp_account_changed`.
    async fn disconnect(&self, user: &str, generation: i64) -> LinkedResult<bool>;
}

/// Group metadata kept fresh by the session service.
#[async_trait]
pub trait GroupRepository: Send + Sync {
    /// Current workspace membership facts for server-selected adoption.
    async fn user_team(&self, user: &str) -> LinkedResult<Option<Uuid>>;
    /// Groups the account has joined, as last observed.
    async fn account_groups(&self, account: Uuid) -> LinkedResult<Vec<GroupInfo>>;
    /// One joined group, as last observed.
    async fn account_group(&self, account: Uuid, group: &str) -> LinkedResult<Option<GroupInfo>>;
    /// Ask the account's replica to re-read its groups (`whatsapp_groups_requested`).
    async fn request_groups_refresh(&self, account: Uuid) -> LinkedResult<()>;
    /// For each remote group, the adopted entity that the person can see.
    async fn visible_adoptions(
        &self,
        user: &str,
        groups: &[String],
    ) -> LinkedResult<Vec<(String, GroupReference)>>;
    /// Latest metadata for a binding's group from any account consenting to it.
    async fn binding_roster(&self, binding: &Binding) -> LinkedResult<Option<GroupInfo>>;
}

/// A new binding, authorized by the domain.
pub struct AdoptionRecord<'a> {
    /// Adopting person.
    pub user: &'a str,
    /// Their account at the generation that authorized adoption.
    pub account: &'a Account,
    /// Validated request.
    pub request: &'a AdoptGroup,
    /// Fresh metadata that authorized adoption.
    pub group: &'a GroupInfo,
}

/// Result of adoption.
pub struct Adopted {
    /// The binding.
    pub binding: Binding,
    /// Whether this call created the standalone entity.
    pub created: bool,
}

/// Standalone group entities and their lifecycle.
#[async_trait]
pub trait BindingRepository: Send + Sync {
    /// The binding of a group entity.
    async fn binding(&self, group_id: Uuid) -> LinkedResult<Option<Binding>>;
    /// Adopt atomically, serialized per team and remote group. Existing groups
    /// require ordinary view access; new groups grant only the caller Owner.
    /// Records the caller-account's membership and signals its session service.
    async fn adopt(&self, record: AdoptionRecord<'_>) -> LinkedResult<Adopted>;
    /// Attachments of these group messages of the binding.
    async fn message_attachments(
        &self,
        binding: &Binding,
        messages: &[Uuid],
    ) -> LinkedResult<Vec<MessageAttachments>>;
    /// Detach locally: end observing consents and fail undispatched sends.
    /// History stays. Signals `whatsapp_account_changed` for every observer.
    async fn detach(&self, binding: &Binding) -> LinkedResult<()>;
}

/// The facts that decide whether a person can send in a binding now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SendingFacts {
    /// The account's membership has consent at its current generation.
    pub observing: bool,
    /// The account is in the group.
    pub remote_member: bool,
    /// The account may post under current group settings.
    pub can_post: bool,
    /// When the membership facts were last observed.
    pub observed_at: Option<DateTime<Utc>>,
}

/// Membership eligibility derived only from the caller's own protocol metadata.
pub(crate) fn sending_facts_from_roster(
    account: &Account,
    group: Option<GroupInfo>,
) -> SendingFacts {
    SendingFacts {
        observing: group.is_some(),
        remote_member: group.as_ref().is_some_and(|g| {
            account
                .identity_jid
                .as_deref()
                .is_some_and(|i| g.participant(i).is_some())
        }),
        can_post: group.as_ref().is_some_and(|g| {
            account
                .identity_jid
                .as_deref()
                .is_some_and(|i| g.can_post(i))
        }),
        observed_at: group.map(|g| g.observed_at),
    }
}

/// What a mutation request points at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MutationTarget {
    /// Source time of the original message.
    pub source_at: DateTime<Utc>,
    /// The original was sent from this verified identity.
    pub sent_by: Vec<String>,
    /// Already deleted.
    pub deleted: bool,
}

/// A validated intent, authorized by the domain.
pub struct SendIntent<'a> {
    /// Sending person.
    pub user: &'a str,
    /// Their account at its current generation.
    pub account: &'a Account,
    /// Binding.
    pub binding: &'a Binding,
    /// Request.
    pub request: &'a SendReply,
    /// SHA-256 of the canonical request.
    pub digest: [u8; 32],
}

/// A validated attachment upload.
pub struct StagedUpload<'a> {
    /// Uploader, who will own the document.
    pub user: &'a str,
    /// Group it may be sent to.
    pub group_id: Uuid,
    /// Display filename.
    pub filename: &'a str,
    /// Supported MIME type.
    pub mime: &'a str,
    /// Bytes, at most [`MEDIA_LIMIT_BYTES`].
    pub bytes: &'a [u8],
    /// SHA-256 of `bytes`.
    pub sha256: [u8; 32],
}

/// Durable send intents.
#[async_trait]
pub trait SendRepository: Send + Sync {
    /// Stage an attachment for a later send by the same person in the same group.
    async fn stage_upload(&self, upload: StagedUpload<'_>) -> LinkedResult<Uuid>;
    /// MIME type and filename of the person's staged upload in this group.
    async fn staged_upload(
        &self,
        user: &str,
        group_id: Uuid,
        upload: Uuid,
    ) -> LinkedResult<Option<(String, String)>>;
    /// Own-account membership facts for the person's account in the binding.
    async fn sending_facts(
        &self,
        account: &Account,
        binding: &Binding,
    ) -> LinkedResult<SendingFacts>;
    /// The source of a group message in this binding, for quotes and mutations.
    async fn mutation_target(
        &self,
        binding: &Binding,
        message: Uuid,
    ) -> LinkedResult<Option<MutationTarget>>;
    /// Record the intent and assign the group sequence. Replays with the same key
    /// return the stored progress; a different payload is a `Conflict`. Inserts
    /// only while the account is connected at its generation, the binding is
    /// active and the membership still observes. Signals `whatsapp_send_requested`.
    async fn enqueue(&self, intent: SendIntent<'_>) -> LinkedResult<SendProgress>;
    /// The person's sends in a group that are not yet accepted, newest first.
    async fn open_sends(&self, group_id: Uuid, user: &str) -> LinkedResult<Vec<SendProgress>>;
    /// The person's sends for these group messages or intent ids.
    async fn sends_for(
        &self,
        group_id: Uuid,
        user: &str,
        ids: &[Uuid],
    ) -> LinkedResult<Vec<SendProgress>>;
}

/// Session-service state transitions, all fenced by the lease epoch.
#[async_trait]
pub trait SessionRepository: Send + Sync {
    /// The account's lifecycle, unfenced.
    async fn account_state(&self, account: Uuid) -> LinkedResult<Option<AccountState>>;
    /// Accounts needing a replica whose advisory lock
    /// (`hashtext('whatsapp-account:' || id)`) nobody holds.
    async fn discoverable_accounts(&self, limit: i64) -> LinkedResult<Vec<Uuid>>;
    /// Fleet counts for health checks.
    async fn fleet_health(&self) -> LinkedResult<FleetHealth>;
    /// Store an inbound event for later ingestion, fenced; idempotent on id.
    async fn enqueue_inbound(&self, scope: SessionScope, event: &InboundEvent) -> LinkedResult<()>;
    /// Bump the lease epoch and recover the previous replica's sends: claimed but
    /// undispatched become `pending`; dispatched without outcome become `unknown`.
    async fn begin_lease(&self, account: Uuid) -> LinkedResult<Lease>;
    /// Return claimed but undispatched sends to `pending` before handing over.
    async fn release_lease(&self, scope: SessionScope) -> LinkedResult<()>;
    /// Remove and return the owner's WebAuthn assertion, so it is forwarded once.
    async fn take_passkey_response(
        &self,
        scope: SessionScope,
        pairing: Uuid,
    ) -> LinkedResult<Option<serde_json::Value>>;
    /// Claim attachments this account observed and has not downloaded yet.
    async fn claim_media_imports(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> LinkedResult<Vec<MediaImport>>;
    /// Keep downloaded bytes for import into a private document. The bytes must
    /// match the expected hash; a ready attachment is never rewritten.
    async fn complete_media_import(
        &self,
        scope: SessionScope,
        attachment: &AttachmentRef,
        bytes: &[u8],
    ) -> LinkedResult<()>;
    /// Record a failed download; a permanent failure or too many attempts marks
    /// the attachment failed and shows a notice on the message.
    async fn fail_media_import(
        &self,
        scope: SessionScope,
        attachment: &AttachmentRef,
        failure: MediaFailure,
    ) -> LinkedResult<()>;
    /// Bytes of the attachment of a send this replica claimed.
    async fn outbound_media(&self, scope: SessionScope, send: Uuid) -> LinkedResult<OutboundMedia>;
    /// A pairing transaction by id; expires it first when past its deadline.
    async fn pairing_work(&self, pairing: Uuid) -> LinkedResult<Option<PairingWork>>;
    /// The account's live pairing transaction, if any.
    async fn live_pairing(&self, scope: SessionScope) -> LinkedResult<Option<PairingWork>>;
    /// Apply progress to a live transaction. `Success` connects the account when
    /// the identity matches the expected one and belongs to no other account;
    /// otherwise the transaction fails with `Conflict` or `Forbidden`.
    async fn update_pairing(
        &self,
        scope: SessionScope,
        pairing: Uuid,
        update: &PairingUpdate,
    ) -> LinkedResult<PairingWork>;
    /// WhatsApp ended the session: `logged_out`, generation + 1, consents end,
    /// undispatched sends fail.
    async fn logged_out(&self, scope: SessionScope) -> LinkedResult<()>;
    /// Store group metadata and reconcile remote memberships of adopted
    /// bindings. With `complete`, groups not listed are treated as left.
    async fn update_groups(
        &self,
        scope: SessionScope,
        groups: &[GroupInfo],
        complete: bool,
    ) -> LinkedResult<()>;
    /// Groups this account currently observes for at least one adopted binding.
    async fn observed_groups(&self, scope: SessionScope) -> LinkedResult<Vec<String>>;
    /// Persist one validated event into every binding it is observed for.
    async fn ingest(
        &self,
        scope: SessionScope,
        event: &InboundEvent,
    ) -> LinkedResult<IngestOutcome>;
    /// Deferred events whose retry time has come.
    async fn due_events(&self, scope: SessionScope, limit: i64) -> LinkedResult<Vec<InboundEvent>>;
    /// Claim pending sends in group order; expired ones fail instead.
    async fn claim_sends(&self, scope: SessionScope, limit: i64) -> LinkedResult<Vec<ClaimedSend>>;
    /// Record that the request is about to be submitted with this message id,
    /// after re-checking every sending fact. After this returns, the send is
    /// never retried automatically.
    async fn begin_dispatch(
        &self,
        scope: SessionScope,
        send: Uuid,
        source_id: &str,
    ) -> LinkedResult<()>;
    /// Record the outcome; an acceptance also writes the group message.
    async fn record_send_outcome(
        &self,
        scope: SessionScope,
        send: Uuid,
        outcome: &SendOutcome,
    ) -> LinkedResult<()>;
}

/// Who wrote a group message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    /// A person's phone or WhatsApp app.
    Whatsapp,
    /// A deliberate send from Macro.
    Macro,
    /// History sync.
    History,
}

/// A group message revision that still needs generic notifications.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupEffect {
    /// Group entity.
    pub group_id: Uuid,
    /// Group message.
    pub message_id: Uuid,
    /// Revision to publish.
    pub revision: i64,
    /// Nothing was published for this message before.
    pub first_publication: bool,
    /// Who wrote it.
    pub origin: Origin,
    /// Verified Macro user behind a phone-origin message, never notified of it.
    pub associated_user: Option<String>,
}

impl GroupEffect {
    /// Only a newly received live message creates a notification.
    pub fn should_notify(&self) -> bool {
        self.first_publication && self.origin != Origin::History
    }
}

/// The notification outbox.
#[async_trait]
pub trait EffectsRepository: Send + Sync {
    /// Due revisions, oldest first.
    async fn pending_effects(&self, limit: i64) -> LinkedResult<Vec<GroupEffect>>;
    /// Mark exactly this revision published; later revisions stay due.
    async fn published(&self, message: Uuid, revision: i64) -> LinkedResult<()>;
    /// Retry this message later without blocking others.
    async fn defer_effect(&self, message: Uuid) -> LinkedResult<()>;
}

/// Generic notifications for current group viewers.
#[async_trait]
pub trait GroupPublisher: Send + Sync {
    /// Publish one message revision to its current viewers.
    async fn publish(&self, effect: &GroupEffect) -> LinkedResult<()>;
}

/// Downloaded or uploaded bytes waiting to become a private document.
#[derive(Clone)]
pub struct DocumentImport {
    /// Which attachment.
    pub attachment: AttachmentRef,
    /// Reserved document id.
    pub document_id: Uuid,
    /// Channel the document is shared with.
    pub group_id: Uuid,
    /// Owner of the document.
    pub owner: String,
    /// Display filename.
    pub filename: String,
    /// MIME type.
    pub mime: String,
    /// SHA-256 of `bytes`.
    pub sha256: [u8; 32],
    /// Plaintext bytes.
    pub bytes: Vec<u8>,
    /// Earlier failed imports.
    pub attempts: i32,
}

/// The import queue between blobs and documents.
#[async_trait]
pub trait MediaRepository: Send + Sync {
    /// Imports whose retry time has come.
    async fn due_imports(&self, limit: i64) -> LinkedResult<Vec<DocumentImport>>;
    /// The document holds the bytes: attach it to the message, drop the blob and
    /// queue publication.
    async fn import_stored(&self, import: &DocumentImport) -> LinkedResult<()>;
    /// Retry later, or give up and show a notice on the message.
    async fn import_failed(&self, import: &DocumentImport, permanent: bool) -> LinkedResult<()>;
    /// Delete staged uploads nobody sent.
    async fn expire_uploads(&self) -> LinkedResult<u64>;
}

/// Private document storage owned by the documents domain.
#[async_trait]
pub trait DocumentStore: Send + Sync {
    /// Create the document with the reserved id, owned by `owner`, holding the
    /// bytes; group viewers inherit attachment access. Never rewrites uploaded bytes.
    async fn store(&self, import: &DocumentImport) -> LinkedResult<()>;
}

/// Native authorization owned by entity access.
#[async_trait]
pub trait Authorizer: Send + Sync {
    /// The person is a member of the workspace.
    async fn require_team_member(&self, team: Uuid, user: &str) -> LinkedResult<()>;
    /// The person owns the group entity.
    async fn require_group_owner(&self, group_id: Uuid, user: &str) -> LinkedResult<()>;
}
