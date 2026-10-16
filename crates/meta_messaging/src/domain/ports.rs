//! Persistence, provider and native Macro capabilities. Domain services own
//! authorization and policy; composition roots own cross-domain transactions.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::{connection::*, events::*, history::*, models::*};

/// Diagnostic result, whose context is safe to expose and whose cause is internal.
pub type PortResult<T> = Result<T, rootcause::Report<MessagingError>>;

/// Fence shared by claim, checkpoint, heartbeat and settlement.
#[derive(Debug, Clone)]
pub struct Lease {
    /// Durable work identity.
    pub id: Uuid,
    /// Unique attempt identity, invalid after restart/reclaim.
    pub token: Uuid,
}

/// A claimed, immutable receipt.
pub struct ReceiptWork {
    /// Original receipt time; queued history predating explicit consent stays ignored.
    pub received_at: DateTime<Utc>,
    /// Current fence.
    pub lease: Lease,
    /// Verified product endpoint.
    pub provider: Provider,
    /// Retained provider envelope, untrusted content.
    pub payload: serde_json::Value,
    /// Number of attempts including this one.
    pub attempts: u16,
}

/// A claimed external send intent.
#[derive(Clone)]
pub struct SendWork {
    /// Current fence.
    pub lease: Lease,
    /// Account to dispatch through.
    pub connection_id: Uuid,
    /// Native channel whose permission must be rechecked.
    pub channel_id: Uuid,
    /// Original authenticated author.
    pub user_id: String,
    /// Original enqueue time, retained during native-message recovery.
    pub created_at: DateTime<Utc>,
    /// Original, immutable send intent.
    pub request: SendReply,
    /// Exact prepared text retained before dispatch, including template substitution.
    pub rendered_text: Option<String>,
    /// Number of attempts including this one.
    pub attempts: u16,
}

/// Exclusive provider-subscription ownership during lifecycle I/O. Dropping the guard
/// releases it, including when the task is cancelled. Connect uses the same scope.
pub trait SubscriptionGuard: Send {}

/// Meta-owned durable state. All mutations preserve account/team bindings and
/// compare lease tokens/expiry for worker transitions.
#[async_trait]
pub trait MessagingRepository: ConversationRepository {
    /// Try to serialize lifecycle operations across every connection using this subscription.
    /// A busy scope returns None, so queued callers cannot exhaust database connections.
    async fn lock_subscription(
        &self,
        connection: &Connection,
    ) -> PortResult<Option<Box<dyn SubscriptionGuard>>>;
    /// Whether any non-disconnected account still depends on this provider subscription.
    /// Includes other teams; only a boolean crosses the domain boundary.
    async fn subscription_in_use(&self, connection: &Connection) -> PortResult<bool>;

    /// Explicit consent/status for this authorization generation only.
    async fn history_import(&self, connection: &Connection) -> PortResult<Option<HistoryImport>>;
    /// Atomically schedule explicit import or resume a failed Instagram checkpoint.
    async fn request_history_import(&self, connection: &Connection, user: &str) -> PortResult<()>;
    /// Claim one import checkpoint, reclaiming expired leases.
    async fn claim_history_import(&self) -> PortResult<Option<HistoryWork>>;
    /// Renew only a valid lease on a still-connected authorization generation.
    async fn heartbeat_history_import(&self, lease: &Lease) -> PortResult<bool>;
    /// Checkpoint before one-time POSTs or after safely persisted read pages.
    async fn checkpoint_history_import(
        &self,
        work: &HistoryWork,
        step: HistoryStep,
        cursor: Option<&str>,
        request_id: Option<&str>,
    ) -> PortResult<()>;
    /// Finish or release one fenced attempt. Failed reads may retry with bounded backoff.
    async fn settle_history_import(
        &self,
        work: &HistoryWork,
        status: HistoryStatus,
        error: Option<&str>,
        retry: Option<u32>,
    ) -> PortResult<()>;
    /// Resolve late history media against its original message's customer and direction.
    async fn history_message_identity(
        &self,
        connection: Uuid,
        message: &ProviderId,
    ) -> PortResult<Option<(ProviderId, Direction)>>;
    /// Return the consenting actor only for eligible history in this generation.
    async fn history_consent_user(
        &self,
        connection: &Connection,
        received_at: DateTime<Utc>,
    ) -> PortResult<Option<String>>;
    /// Stop an import after its consenting administrator loses access.
    async fn revoke_history_consent(&self, connection: &Connection) -> PortResult<()>;
    /// Apply monotonic provider progress without changing live account health.
    async fn history_import_progress(
        &self,
        connection: &Connection,
        progress: Option<u8>,
        declined: bool,
    ) -> PortResult<()>;
    /// Mark unavailable historical media without hiding imported text.
    async fn history_media_unavailable(&self, connection: &Connection) -> PortResult<()>;

    /// List team account health, without credentials.
    async fn connections(&self, team: Uuid) -> PortResult<Vec<Connection>>;
    /// Store an anti-CSRF authorization transaction.
    async fn begin_authorization(&self, attempt: &OAuthAttempt) -> PortResult<()>;
    /// Consume state once, only for the same authenticated initiator/team.
    async fn consume_authorization(
        &self,
        digest: &[u8],
        team: Uuid,
        user: &str,
    ) -> PortResult<OAuthAttempt>;
    /// Bind a verified provider identity, rejecting cross-team or wrong-account reconnects.
    async fn connect(
        &self,
        connection: &Connection,
        encrypted_token: &[u8],
        reconnect: Option<Uuid>,
    ) -> PortResult<Connection>;
    /// Fetch one connection. Caller independently verifies its scope.
    async fn connection(&self, id: Uuid) -> PortResult<Option<Connection>>;
    /// Resolve a webhook's exact provider/account binding.
    async fn account(&self, provider: Provider, id: &ProviderId) -> PortResult<Option<Connection>>;
    /// Resolve only connections sharing the provider-reported WhatsApp account.
    async fn business_accounts(&self, id: &ProviderId) -> PortResult<Vec<Connection>>;
    /// Read the sealed credential; never return this from an API.
    async fn credential(&self, id: Uuid) -> PortResult<Vec<u8>>;
    /// Erase credentials and stop future sends, preserving account mapping/content.
    async fn disconnect(&self, team: Uuid, id: Uuid) -> PortResult<()>;
    /// Apply a provider revocation only to the generation active when it arrived.
    async fn disconnect_received(
        &self,
        connection: &Connection,
        received_at: DateTime<Utc>,
    ) -> PortResult<()>;
    /// Persist subscription/health outcome.
    async fn health(
        &self,
        connection: &Connection,
        status: ConnectionStatus,
        error: Option<&str>,
    ) -> PortResult<()>;
    /// Store refreshed credentials only while the connection remains active.
    async fn refresh_credential(
        &self,
        connection: &Connection,
        encrypted: &[u8],
        expires: DateTime<Utc>,
    ) -> PortResult<()>;
    /// Connections requiring subscription/health/credential maintenance, bounded.
    async fn maintenance_connections(&self) -> PortResult<Vec<Connection>>;
    /// Store one verified envelope before acknowledging receipt.
    async fn accept_receipt(
        &self,
        provider: Provider,
        digest: &[u8],
        payload: &serde_json::Value,
    ) -> PortResult<()>;
    /// Lease a pending receipt or reclaim an expired attempt.
    async fn claim_receipt(&self) -> PortResult<Option<ReceiptWork>>;
    /// Renew the exact receipt attempt while processing bounded event/media work.
    async fn heartbeat_receipt(&self, lease: &Lease) -> PortResult<bool>;
    /// Apply the domain's bounded, lease-safe raw-payload and receipt-metadata retention policy.
    async fn cleanup_receipts(&self) -> PortResult<super::retention::ReceiptCleanup>;
    /// Retain syntax-failure diagnostics before processing valid siblings. This
    /// monotonic count survives retries and never includes customer content.
    async fn record_receipt_decode_failures(&self, lease: &Lease, failures: u32) -> PortResult<()>;
    /// Retry with bounded delay, or settle. Invalid fences cannot settle newer work.
    async fn settle_receipt(
        &self,
        lease: &Lease,
        error: Option<&str>,
        retry_seconds: Option<u32>,
    ) -> PortResult<()>;
    /// Retain status independently of message arrival and reconcile monotonic state.
    async fn record_status(
        &self,
        connection: Uuid,
        message: &ProviderId,
        state: DeliveryState,
        occurred_at: DateTime<Utc>,
        error: Option<&str>,
    ) -> PortResult<()>;
    /// Existing account-scoped identity, to avoid a provider profile lookup per message.
    async fn customer_profile(
        &self,
        connection: Uuid,
        customer: &ProviderId,
    ) -> PortResult<Option<CustomerProfile>>;
    /// Whether all media for this message was already materialized.
    async fn media_stored(&self, connection: Uuid, message: &ProviderId) -> PortResult<bool>;
}

/// Official Meta calls. Transport adapters never decide send authorization.
#[async_trait]
pub trait MetaProvider: Send + Sync {
    /// One official WhatsApp sync request. The domain fences it before dispatch.
    async fn request_whatsapp_history(
        &self,
        connection: &Connection,
        token: &AccessToken,
        contacts: bool,
    ) -> PortResult<String>;
    /// Read one bounded Instagram conversation page, never follow arbitrary paging URLs.
    async fn instagram_history(
        &self,
        connection: &Connection,
        token: &AccessToken,
        after: Option<&str>,
    ) -> PortResult<HistoryPage>;

    /// Resolve a consenting Instagram sender's name and handle with this account's token.
    async fn customer_profile(
        &self,
        connection: &Connection,
        token: &AccessToken,
        customer: &ProviderId,
    ) -> PortResult<CustomerProfile>;
    /// Exchange a code and verify selected account ownership and coexistence.
    async fn authorize(
        &self,
        provider: Provider,
        input: &CompleteAuthorization,
    ) -> PortResult<AuthorizedAccount>;
    /// Explicitly configured local developer account; never relax production signup.
    async fn developer_account(&self) -> PortResult<AuthorizedAccount>;
    /// Subscribe the verified account to the app's configured webhook fields.
    async fn subscribe(&self, connection: &Connection, token: &AccessToken) -> PortResult<()>;
    /// Remove this app's account subscription.
    async fn unsubscribe(&self, connection: &Connection, token: &AccessToken) -> PortResult<()>;
    /// Refresh an eligible long-lived Instagram token; return actual new expiry.
    async fn refresh(&self, token: &AccessToken) -> PortResult<(AccessToken, DateTime<Utc>)>;
    /// Account-specific approved WhatsApp templates, with bounded pagination.
    async fn templates(
        &self,
        connection: &Connection,
        token: &AccessToken,
    ) -> PortResult<Vec<Template>>;
    /// Resolve approval/media before the domain's final permission/window check.
    async fn prepare_reply(
        &self,
        connection: &Connection,
        token: &AccessToken,
        conversation: &Conversation,
        request: &SendReply,
        media: Option<&OutboundMedia>,
    ) -> PortResult<PreparedReply>;
    /// One deliberate provider send, after final authorization and durable preflight.
    async fn send(
        &self,
        connection: &Connection,
        token: &AccessToken,
        prepared: &PreparedReply,
    ) -> ProviderSendResult;
    /// Download provider media using a restricted host policy and byte ceiling.
    async fn download(
        &self,
        connection: &Connection,
        token: &AccessToken,
        media: &IncomingMedia,
    ) -> PortResult<MediaBytes>;
}

/// Provider-resolved content. The domain retains its display text but treats the
/// provider document as opaque; HTTP construction remains in the adapter.
pub struct PreparedReply {
    /// Exact text (or descriptive attachment text) represented in the native channel.
    pub rendered_text: String,
    /// Provider-owned message representation, without authentication credentials.
    pub provider_document: serde_json::Value,
}

/// External delivery outcome, retaining the distinction between rejection and uncertainty.
pub enum ProviderSendResult {
    /// Provider supplied a stable message ID.
    Accepted(ProviderId),
    /// Definitive, retryable rate limit/rejection before acceptance.
    RetryAfter(u32),
    /// Definitive rejection, sanitized code only.
    Rejected(String),
    /// Timeout, transport interruption or malformed success; never resend automatically.
    Unknown,
}

/// Private file data passed between authorized native storage and the provider.
pub struct MediaBytes {
    /// Display filename with no path components.
    pub filename: String,
    /// Verified supported MIME type.
    pub mime_type: String,
    /// Bounded bytes.
    pub bytes: Vec<u8>,
}

/// Media resolved from a Macro document, including a short-lived provider fetch URL.
pub struct OutboundMedia {
    /// Authorized original bytes (WhatsApp upload).
    pub file: MediaBytes,
    /// Short-lived URL for Instagram's server fetch.
    pub url: String,
}

/// Server-only credential protection bound to team and connection as authenticated context.
#[async_trait]
pub trait CredentialCipher: Send + Sync {
    /// Seal a token with an existing KMS key.
    async fn encrypt(
        &self,
        team: Uuid,
        connection: Uuid,
        token: &AccessToken,
    ) -> PortResult<Vec<u8>>;
    /// Unseal only in the original team/connection context.
    async fn decrypt(&self, team: Uuid, connection: Uuid, sealed: &[u8])
    -> PortResult<AccessToken>;
}

/// Owning Macro domain services are supplied at the composition root. This
/// boundary never constructs repositories from another crate's outbound module.
#[async_trait]
pub trait NativeMessaging: NativeConversation {
    /// Retain and apply a source-scoped revision without creating a message.
    async fn revise(&self, connection: &Connection, revision: &IncomingRevision) -> PortResult<()>;
    /// Revalidate the current management role before background work.
    async fn require_admin(&self, team: Uuid, user: &str) -> PortResult<()>;
    /// Commit channel/mapping/message atomically, with deduplication and silent
    /// history semantics. Live facts go into durable post-commit publication.
    /// Media slots retain provider ordinals; unavailable items cannot renumber or
    /// prevent storing healthy attachments from the same message.
    async fn ingest(
        &self,
        connection: &Connection,
        message: &IncomingMessage,
        media: Vec<Option<MediaBytes>>,
    ) -> PortResult<()>;
    /// Persist a visible unavailable-media notice without losing the source text.
    async fn media_unavailable(
        &self,
        connection: &Connection,
        message: &IncomingMessage,
    ) -> PortResult<()>;
}

/// Shared native mappings and durable send state, with lease and account fencing.
#[async_trait]
pub trait ConversationRepository: Send + Sync {
    /// Current account scope without provider configuration or credentials.
    async fn account_scope(&self, id: Uuid) -> PortResult<Option<super::replies::AccountScope>>;
    /// Find the real channel mapping.
    async fn conversation(&self, channel: Uuid) -> PortResult<Option<Conversation>>;
    /// Check a quoted provider message against this exact account and customer.
    async fn has_message(
        &self,
        conversation: &Conversation,
        message: &ProviderId,
    ) -> PortResult<bool>;
    /// Persist intentional send; same key/payload replays, changed payload conflicts.
    async fn enqueue_send(
        &self,
        connection: Uuid,
        channel: Uuid,
        user: &str,
        request: &SendReply,
        digest: &[u8],
    ) -> PortResult<SendProgress>;
    /// Channel-scoped status feed for native message/composer UI.
    async fn sends(&self, channel: Uuid) -> PortResult<Vec<SendProgress>>;
    /// Delivery for explicitly requested native messages, including older history.
    async fn sends_for_messages(
        &self,
        channel: Uuid,
        messages: &[Uuid],
    ) -> PortResult<Vec<SendProgress>>;
    /// Lease an unattempted/rejected-retry send. Expired Sending becomes Unknown.
    async fn claim_send(&self) -> PortResult<Option<SendWork>>;
    /// Accepted replies missing native materialization. Recovery never sends them again.
    async fn accepted_sends(&self) -> PortResult<Vec<(SendWork, ProviderId)>>;
    /// Back off failed native recovery without altering provider acceptance or resending.
    async fn defer_accepted_send(
        &self,
        work: &SendWork,
        provider_id: &ProviderId,
    ) -> PortResult<()>;
    /// Atomically fence dispatch against disconnect/reconnect and retain the sent body.
    /// Once this succeeds the attempt is in flight; later disconnect cannot recall it.
    async fn prepare_send(
        &self,
        lease: &Lease,
        connection: &super::replies::AccountScope,
        rendered_text: &str,
    ) -> PortResult<()>;
    /// Persist provider result; ambiguous outcomes never automatically retry.
    async fn settle_send(
        &self,
        lease: &Lease,
        state: DeliveryState,
        provider_id: Option<&ProviderId>,
        error: Option<&str>,
        retry_seconds: Option<u32>,
    ) -> PortResult<()>;
}

/// Native authorization, private files and publication needed by shared sends.
#[async_trait]
pub trait NativeConversation: Send + Sync {
    /// Stage a human-selected file privately through the owning document service.
    async fn upload_attachment(
        &self,
        user: &str,
        channel: Uuid,
        file: MediaBytes,
    ) -> PortResult<UploadedAttachment>;
    /// Revalidate current channel posting access plus account team membership.
    async fn require_send(&self, team: Uuid, channel: Uuid, user: &str) -> PortResult<()>;
    /// Read bytes only with current document and channel permissions.
    async fn outgoing_media(
        &self,
        user: &str,
        channel: Uuid,
        document: Uuid,
    ) -> PortResult<OutboundMedia>;
    /// Materialize a provider-accepted reply in the native channel, idempotently.
    async fn sent(
        &self,
        work: &SendWork,
        conversation: &Conversation,
        connection: &super::replies::AccountScope,
        provider_id: &ProviderId,
    ) -> PortResult<()>;
    /// Publish pending new-message facts and reconcile search using existing
    /// Macro infrastructure; history never becomes live events.
    async fn reconcile_effects(&self) -> PortResult<()>;
}

/// Provider domain rules evaluated using small, generation-bound account scopes.
#[async_trait]
pub trait ReplyPolicy: Send + Sync {
    /// Implemented capabilities and current provider eligibility, before Macro restrictions.
    async fn evaluate(
        &self,
        account: &super::replies::AccountScope,
        conversation: &Conversation,
        now: DateTime<Utc>,
    ) -> PortResult<super::replies::ReplyOptions>;
    /// Validate provider-owned inputs such as current approved template parameters.
    async fn validate_content(
        &self,
        account: &super::replies::AccountScope,
        request: &SendReply,
    ) -> PortResult<()>;
}

/// Prepare transport work without sending; the shared service performs the final checks.
#[async_trait]
pub trait ReplyTransport: Send + Sync {
    /// Resolve provider inputs using already authorized native media.
    async fn prepare(
        &self,
        account: &super::replies::AccountScope,
        conversation: &Conversation,
        request: &SendReply,
        media: Option<&OutboundMedia>,
    ) -> PortResult<Box<dyn PreparedSend>>;
}

/// Single-use prepared transport; credentials remain inside the provider implementation.
#[async_trait]
pub trait PreparedSend: Send + Sync {
    /// Exact native display text retained durably before dispatch.
    fn rendered_text(&self) -> &str;
    /// Send once after the shared service's permission/policy checks and durable fence.
    /// An error means the outcome is unknown, so it is never treated as a rejection.
    async fn dispatch(self: Box<Self>) -> PortResult<ProviderSendResult>;
}
