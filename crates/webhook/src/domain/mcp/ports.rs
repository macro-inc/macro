//! Ports of MCP Events webhook subscriptions.

use super::filter::McpEventFilter;
use super::models::{
    McpDeliveryOutcome, McpDeliveryProfile, McpEndpointFailure, McpEventQueueMessage,
    McpEventSubscription, McpMatchCandidate, McpPreviousSecret, McpSecretCiphertext,
    McpSubscribeRequest, McpSubscribeResult, McpSubscriptionId, McpSubscriptionKey,
};
use crate::domain::models::{NormalizedWebhookEvent, WebhookWorkerDisposition};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use std::future::Future;
use uuid::Uuid;
use webhook_signature::standard::SigningSecret;

/// A subscription row to insert, or to refresh in place when its user and
/// subscription id already have one.
#[derive(Debug, Clone)]
pub struct McpSubscriptionUpsert {
    /// Row id used when inserting.
    pub id: Uuid,
    /// The key it was derived from.
    pub key: McpSubscriptionKey,
    /// Its derived id.
    pub subscription_id: McpSubscriptionId,
    /// The compiled filter.
    pub filter: McpEventFilter,
    /// The new encrypted secret.
    pub secret: McpSecretCiphertext,
    /// The stored secret's ciphertext when the row was read, `None` when
    /// there was no row: the refresh was decided against that row, so it is
    /// not written over a row that has changed since.
    pub read_secret: Option<Vec<u8>>,
    /// The secret this refresh replaced, or the one an earlier refresh
    /// replaced while its window lasts.
    pub previous_secret: Option<McpPreviousSecret>,
    /// Whose conventions its deliveries follow.
    pub profile: McpDeliveryProfile,
    /// The granted expiry.
    pub expires_at: DateTime<Utc>,
}

/// What storing a subscription did.
#[derive(Debug, Clone, PartialEq)]
pub enum McpStoreOutcome {
    /// Stored or refreshed.
    Stored(Box<McpEventSubscription>),
    /// The user already holds the most subscriptions allowed.
    QuotaExceeded,
    /// The row is no longer the one read: another refresh wrote it first.
    Changed,
}

/// Storage of MCP webhook subscriptions.
pub trait McpSubscriptionRepo: Clone + Send + Sync + 'static {
    /// Repository error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// One user's subscription by derived id, expired or not.
    fn get(
        &self,
        user_id: &MacroUserIdStr<'static>,
        subscription_id: &McpSubscriptionId,
    ) -> impl Future<Output = Result<Option<McpEventSubscription>, Self::Err>> + Send;

    /// A live subscription by row id.
    fn get_live(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<McpEventSubscription>, Self::Err>> + Send;

    /// Insert, or refresh the secrets, profile, filter and expiry of the
    /// existing row if it still holds `upsert.read_secret`,
    /// unless the user would then hold more than `max` live subscriptions.
    /// Expired rows do not count. Serialized per user, so
    /// concurrent subscribes cannot pass the limit together.
    fn store_within_quota(
        &self,
        upsert: McpSubscriptionUpsert,
        max: u32,
    ) -> impl Future<Output = Result<McpStoreOutcome, Self::Err>> + Send;

    /// Delete one user's subscription; whether a row was deleted.
    fn delete(
        &self,
        user_id: &MacroUserIdStr<'static>,
        subscription_id: &McpSubscriptionId,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Delete up to [`SWEEP_BATCH`](super::service::SWEEP_BATCH) expired
    /// subscriptions of any user, oldest first; how many were deleted.
    fn delete_expired_batch(&self) -> impl Future<Output = Result<u64, Self::Err>> + Send;

    /// Whether the user holds a live subscription to `endpoint_url`, which
    /// means the endpoint was verified for them.
    fn has_live_endpoint(
        &self,
        user_id: &MacroUserIdStr<'static>,
        endpoint_url: &str,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// The owner of each live subscription, at most
    /// [`LIVE_SUBSCRIBERS_MAX_ROWS`](super::live_subscribers::LIVE_SUBSCRIBERS_MAX_ROWS)
    /// plus one, so the caller can tell a full read from a cut one. A user
    /// appears once per subscription.
    fn list_live_subscriber_ids(
        &self,
    ) -> impl Future<Output = Result<Vec<String>, Self::Err>> + Send;

    /// Live subscriptions of any of `user_ids` whose filter names
    /// `event_name`, with only what matching reads.
    fn list_match_candidates(
        &self,
        user_ids: &[String],
        event_name: &str,
    ) -> impl Future<Output = Result<Vec<McpMatchCandidate>, Self::Err>> + Send;
}

/// Decrypts a subscriber's signing secret.
pub trait McpSecretCipher: Clone + Send + Sync + 'static {
    /// Cipher error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Encrypt `secret` so only `user_id`'s rows decrypt it.
    fn encrypt(
        &self,
        user_id: &MacroUserIdStr<'static>,
        secret: &SigningSecret,
    ) -> impl Future<Output = Result<McpSecretCiphertext, Self::Err>> + Send;

    /// Decrypt a secret stored for `user_id`.
    fn decrypt(
        &self,
        user_id: &MacroUserIdStr<'static>,
        ciphertext: &McpSecretCiphertext,
    ) -> impl Future<Output = Result<SigningSecret, Self::Err>> + Send;
}

/// Sends signed requests to subscribers' callback endpoints, over the same
/// guarded path as webhook deliveries.
pub trait McpEndpointClient: Clone + Send + Sync + 'static {
    /// Prove the endpoint wants deliveries: POST a signed verification
    /// envelope and require the challenge echoed back.
    fn verify(
        &self,
        endpoint_url: &str,
        secret: &SigningSecret,
        subscription_id: &McpSubscriptionId,
    ) -> impl Future<Output = Result<(), McpEndpointVerifyError>> + Send;

    /// POST one delivery, signed with `secret` and, during a rotation, also
    /// with `previous` (Standard Webhooks' space-separated signatures).
    fn deliver(
        &self,
        endpoint_url: &str,
        secret: &SigningSecret,
        previous: Option<&SigningSecret>,
        subscription_id: &McpSubscriptionId,
        message_id: &str,
        body: Vec<u8>,
    ) -> impl Future<Output = McpDeliveryOutcome> + Send;
}

/// Why an endpoint was not verified.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum McpEndpointVerifyError {
    /// The URL is malformed, not HTTPS, or names a host Macro does not call.
    #[error("{0}")]
    InvalidUrl(&'static str),
    /// The endpoint failed verification.
    #[error("callback endpoint failed: {0}")]
    Failed(McpEndpointFailure),
}

/// Queues one delivery to one subscription.
pub trait McpEventEnqueuer: Clone + Send + Sync + 'static {
    /// Enqueuer error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Enqueue a delivery.
    fn enqueue_mcp(
        &self,
        message: McpEventQueueMessage,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Matches an ingested event to MCP subscriptions and queues their
/// deliveries. Driven by webhook ingestion with the same audience webhooks
/// get.
pub trait McpEventFanout: Clone + Send + Sync + 'static {
    /// Queue `event` to every live subscription of the `audience` (personal
    /// workspace ids are user ids; team ids match nothing) whose filter
    /// matches; how many were queued.
    fn fan_out(
        &self,
        event: &NormalizedWebhookEvent,
        audience: &[String],
    ) -> impl Future<Output = Result<usize, McpSubscriptionError>> + Send;
}

/// Ingestion without MCP subscriptions.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoMcpFanout;

impl McpEventFanout for NoMcpFanout {
    async fn fan_out(
        &self,
        _event: &NormalizedWebhookEvent,
        _audience: &[String],
    ) -> Result<usize, McpSubscriptionError> {
        Ok(0)
    }
}

/// Creates, refreshes and removes MCP webhook subscriptions.
pub trait McpEventSubscriptionService: Clone + Send + Sync + 'static {
    /// Make or refresh `user_id`'s subscription.
    fn subscribe(
        &self,
        user_id: MacroUserIdStr<'static>,
        request: McpSubscribeRequest,
    ) -> impl Future<Output = Result<McpSubscribeResult, McpSubscriptionError>> + Send;

    /// Remove `user_id`'s subscription with this key.
    fn unsubscribe(
        &self,
        key: McpSubscriptionKey,
    ) -> impl Future<Output = Result<(), McpSubscriptionError>> + Send;
}

/// Delivers one queued event to one MCP subscription.
pub trait McpEventDeliveryService: Clone + Send + Sync + 'static {
    /// Deliver `message`, received for the `receive_count`th time, and say
    /// what to do with its receipt.
    fn deliver(
        &self,
        message: McpEventQueueMessage,
        receive_count: u32,
    ) -> impl Future<Output = WebhookWorkerDisposition> + Send;
}

/// Why a subscription request failed.
#[derive(Debug, thiserror::Error)]
pub enum McpSubscriptionError {
    /// The request is invalid.
    #[error("{0}")]
    InvalidParams(String),
    /// No subscription has this key.
    #[error("no subscription matches")]
    NotFound,
    /// The user holds the most subscriptions allowed.
    #[error("at most {max} subscriptions")]
    ResourceExhausted {
        /// The limit.
        max: u32,
    },
    /// The callback endpoint failed verification.
    #[error("callback endpoint failed: {0}")]
    CallbackEndpoint(McpEndpointFailure),
    /// Storage, KMS or the queue failed.
    #[error("internal mcp subscription error: {0:?}")]
    Internal(rootcause::Report),
}

impl McpSubscriptionError {
    /// An internal error from any adapter error.
    pub fn internal(error: impl std::error::Error + Send + Sync + 'static) -> Self {
        Self::Internal(rootcause::Report::new(error).into_dynamic())
    }
}

/// A worker without MCP delivery. It leaves MCP messages on the queue for a
/// worker that has it, so none is lost to a misconfigured one; the queue's
/// redrive policy moves them aside if no such worker exists.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoMcpDelivery;

/// How long [`NoMcpDelivery`] hides a message before another worker sees it.
const NO_MCP_DELIVERY_DELAY: std::time::Duration = std::time::Duration::from_secs(30);

impl McpEventDeliveryService for NoMcpDelivery {
    async fn deliver(
        &self,
        message: McpEventQueueMessage,
        _receive_count: u32,
    ) -> WebhookWorkerDisposition {
        tracing::warn!(
            mcp_subscription_id = %message.mcp_subscription_id,
            "mcp event message reached a worker without mcp delivery"
        );
        WebhookWorkerDisposition::RetryAfter(NO_MCP_DELIVERY_DELAY)
    }
}
