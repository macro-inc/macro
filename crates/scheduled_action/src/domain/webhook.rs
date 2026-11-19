//! Routine webhooks: a URL whose POST starts a run of its routine.
//!
//! A routine watches its webhook with a `webhook` event filter, which holds
//! no secret. Its owner mints the URL,
//! shown once: a public hook id and a random 256-bit secret, of which only
//! the SHA-256 is stored. Rotating replaces both, so the old URL stops at
//! once; saving the routine without the filter, or deleting it, deletes them. A POST
//! with an unknown hook, a wrong secret, or a revoked or deleted one gets
//! the same answer after the same work: the stored hash, or a fixed one when
//! there is none, is compared in constant time. The secret is never logged,
//! traced, stored or returned again.
//!
//! An accepted delivery joins the routine's event-run queue as a `webhook`
//! event carrying its body, text that runs read as untrusted data, once the
//! filter's payload tests pass on it; its AI condition is answered like any
//! event's before the run starts. The
//! sender chooses nothing else: not the routine, its steps, its owner or its
//! model. The run acts as, and is billed to, the routine's owner.

use std::net::IpAddr;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Utc};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use macro_uuid::{Uuid, generate_uuid_v7};
use rand::RngCore;
use rootcause::Report;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use utoipa::ToSchema;
use zeroize::Zeroizing;

use super::event_trigger::{EventId, EventReference};
use super::models::ActionPolicyError;
use super::ports::ScheduledActionRepo;
use super::service::granted_action;

#[cfg(test)]
mod test;

/// The largest body a delivery may carry. Like a GitHub delivery's payload,
/// it waits in the queue row and goes into the run's prompt.
pub const MAX_BODY_BYTES: usize = 64 * 1024;
/// Characters of the `Content-Type` header kept.
const MAX_CONTENT_TYPE_CHARS: usize = 255;
/// Deliveries waiting for a routine's run before more are refused.
pub const MAX_QUEUED: u16 = 20;
/// How long a repeated `Idempotency-Key` answers with its first delivery.
pub const IDEMPOTENCY_WINDOW: chrono::Duration = chrono::Duration::hours(24);
/// Requests one address may make to any webhook, counted before the secret
/// is checked, so guessing is as slow as calling.
pub const ADDRESS_LIMIT: Limit = Limit {
    max: 60,
    window: Duration::from_secs(60),
};
/// Accepted calls to one webhook.
pub const HOOK_LIMIT: Limit = Limit {
    max: 30,
    window: Duration::from_secs(60),
};
/// Compared against when no webhook has the presented id, so an unknown
/// hook costs what a wrong secret does.
const NO_HOOK_HASH: SecretHash = SecretHash([0; 32]);
/// Marks a secret as a Macro routine webhook's, for secret scanners.
const SECRET_PREFIX: &str = "mrw_";
/// The prefix and 32 bytes in unpadded base64 (43 characters), with room.
const SECRET_TEXT_CAPACITY: usize = 64;
const SECRET_BYTES: usize = 32;
const MAX_IDEMPOTENCY_KEY: usize = 255;

/// How many requests a window allows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limit {
    pub max: u64,
    pub window: Duration,
}

/// A webhook URL's public id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(transparent)]
#[schema(value_type = String, format = Uuid)]
pub struct HookId(Uuid);

impl HookId {
    pub fn generate() -> Self {
        Self(generate_uuid_v7())
    }
    pub fn as_uuid(self) -> Uuid {
        self.0
    }
}

impl From<Uuid> for HookId {
    fn from(id: Uuid) -> Self {
        Self(id)
    }
}

impl std::fmt::Display for HookId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// A freshly minted secret, held only to show it once. Its `Debug` hides it
/// and it is wiped when dropped.
pub struct WebhookSecret(Zeroizing<String>);

impl WebhookSecret {
    fn generate() -> Self {
        let mut bytes = Zeroizing::new([0u8; SECRET_BYTES]);
        rand::rng().fill_bytes(bytes.as_mut());
        // Room for all of it up front, so no growth leaves an unwiped copy.
        let mut text = Zeroizing::new(String::with_capacity(SECRET_TEXT_CAPACITY));
        text.push_str(SECRET_PREFIX);
        URL_SAFE_NO_PAD.encode_string(bytes.as_ref(), &mut text);
        Self(text)
    }

    /// The secret's text, for the one response that shows it.
    pub fn expose(&self) -> &str {
        &self.0
    }

    fn hash(&self) -> SecretHash {
        SecretHash::of(&self.0)
    }
}

impl std::fmt::Debug for WebhookSecret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("WebhookSecret(..)")
    }
}

/// The SHA-256 of a secret's text: what is stored, and what a presented
/// secret is compared by. A 256-bit random secret needs no slow hash.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct SecretHash([u8; 32]);

impl SecretHash {
    fn of(secret: &str) -> Self {
        Self(Sha256::digest(secret.as_bytes()).into())
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Constant time, so a wrong secret says nothing about the right one.
    fn matches(&self, other: &Self) -> bool {
        self.0.ct_eq(&other.0).into()
    }
}

impl TryFrom<&[u8]> for SecretHash {
    type Error = Report;

    fn try_from(bytes: &[u8]) -> Result<Self, Report> {
        Ok(Self(bytes.try_into().map_err(|_| {
            rootcause::report!("a stored webhook secret hash is not 32 bytes")
        })?))
    }
}

impl std::fmt::Debug for SecretHash {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretHash(..)")
    }
}

/// A sender's `Idempotency-Key`: up to 255 visible ASCII characters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct IdempotencyKey(String);

impl TryFrom<String> for IdempotencyKey {
    type Error = DeliveryError;

    fn try_from(key: String) -> Result<Self, DeliveryError> {
        let valid = !key.is_empty()
            && key.len() <= MAX_IDEMPOTENCY_KEY
            && key
                .bytes()
                .all(|byte| byte.is_ascii_graphic() || byte == b' ');
        if valid {
            Ok(Self(key))
        } else {
            Err(DeliveryError::InvalidIdempotencyKey)
        }
    }
}

impl From<IdempotencyKey> for String {
    fn from(key: IdempotencyKey) -> Self {
        key.0
    }
}

impl IdempotencyKey {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// What a webhook delivered, as its run reads it. The body is the sender's
/// and untrusted; the run's time is its event id's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WebhookDelivery {
    /// The URL it came through. A delivery queued before the routine's URL
    /// was rotated or removed doesn't run.
    pub hook_id: HookId,
    /// The body as sent: UTF-8 text without NUL, possibly empty. Dropped from
    /// the queue row once its run ends; the run's record keeps it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// The sender's `Content-Type`, when it sent one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<IdempotencyKey>,
}

/// A body a delivery may carry: UTF-8 text within the limit.
fn body_text(body: &[u8]) -> Result<&str, DeliveryError> {
    if body.len() > MAX_BODY_BYTES {
        return Err(DeliveryError::TooLarge);
    }
    let body = std::str::from_utf8(body).map_err(|_| DeliveryError::NotText)?;
    // Postgres can't keep U+0000 in the jsonb the queue row holds.
    if body.contains('\0') {
        return Err(DeliveryError::NotText);
    }
    Ok(body)
}

impl WebhookDelivery {
    /// A delivery of `body` through `hook_id`, keeping a bounded content type.
    pub fn new(
        hook_id: HookId,
        body: &str,
        content_type: Option<&str>,
        idempotency_key: Option<IdempotencyKey>,
    ) -> Self {
        Self {
            hook_id,
            body: Some(body.to_owned()),
            content_type: content_type
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.chars().take(MAX_CONTENT_TYPE_CHARS).collect()),
            idempotency_key,
        }
    }

    /// The body read as JSON, when it is JSON, whatever its `Content-Type`
    /// says. Payload tests run against it.
    pub fn json(&self) -> Option<Value> {
        serde_json::from_str(self.body.as_deref()?).ok()
    }
}

/// A routine's webhook, without its secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WebhookInfo {
    pub hook_id: HookId,
    pub created_at: DateTime<Utc>,
    /// The last delivery it accepted.
    pub last_used_at: Option<DateTime<Utc>>,
}

/// A new URL's parts, shown once.
#[derive(Debug)]
pub struct MintedWebhook {
    pub hook_id: HookId,
    pub secret: WebhookSecret,
    pub created_at: DateTime<Utc>,
}

/// Who asks to manage a routine's webhook. Only its owner, signed in as
/// themselves, may see a URL: never an agent session's code, a routine's
/// run or a bot acting for them, so a draft can propose a webhook trigger
/// but never read or mint its URL.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManagingCaller {
    Person,
    /// A request made by an agent session's code, a routine's run or a bot.
    Agent,
}

#[derive(Debug, thiserror::Error)]
pub enum WebhookManagementError {
    #[error("routine not found")]
    NotFound,
    #[error("add a webhook trigger to the routine and save it first")]
    NoWebhookTrigger,
    #[error("only the routine's owner can manage its webhook, from their own account")]
    NotOwnerInPerson,
    #[error("{0}")]
    Internal(Report),
}

/// A POST to a webhook URL, as received.
pub struct DeliveryRequest<'a> {
    /// The path's hook id, unparsed.
    pub hook_id: &'a str,
    /// The bearer token, unparsed; empty when there is none.
    pub secret: &'a str,
    /// The caller's address, when the request has one.
    pub address: Option<IpAddr>,
    pub body: &'a [u8],
    /// The `Content-Type` header, when it is text.
    pub content_type: Option<&'a str>,
    pub idempotency_key: Option<String>,
}

/// An accepted delivery: the run it starts, by id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Delivered {
    Started {
        run_id: Uuid,
    },
    /// A repeat of a key seen within [`IDEMPOTENCY_WINDOW`]: the first
    /// delivery's run, and no second one.
    Repeated {
        run_id: Uuid,
    },
    /// The body failed the filter's payload tests: no run.
    Unmatched,
}

#[derive(Debug, thiserror::Error)]
pub enum DeliveryError {
    /// An unknown hook, a wrong secret, a rotated or removed URL, a deleted
    /// routine: all the same to the caller.
    #[error("not found")]
    NotFound,
    #[error("too many requests")]
    TooManyRequests { retry_after: Duration },
    #[error("the body is larger than 64 KiB")]
    TooLarge,
    #[error("the body must be UTF-8 text without NUL characters")]
    NotText,
    #[error("Idempotency-Key must be 1 to 255 visible ASCII characters")]
    InvalidIdempotencyKey,
    #[error("the routine is paused")]
    Paused,
    #[error("the routine has too many deliveries waiting")]
    Busy { retry_after: Duration },
    #[error("webhooks are unavailable")]
    Unavailable(Report),
}

/// The stored half of a webhook: where it leads, and its secret's hash.
#[derive(Debug, Clone, Copy)]
pub struct StoredHook {
    pub action_id: Uuid,
    pub secret_hash: SecretHash,
}

/// A delivery to queue, rechecked under the routine's lock.
pub struct WebhookAdmission {
    pub action_id: Uuid,
    pub hook_id: HookId,
    pub secret_hash: SecretHash,
    pub event: EventReference,
    /// Repeats of the delivery's key admitted since then answer instead.
    pub repeat_since: DateTime<Utc>,
    pub max_queued: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdmissionOutcome {
    Admitted,
    Repeated {
        run_id: Uuid,
    },
    Paused,
    /// The body failed the filter's payload tests.
    Unmatched,
    Full,
    /// Rotated, removed or deleted since it was found.
    Revoked,
}

/// Webhook rows and webhook deliveries' admission to the event-run queue.
pub trait WebhookStore: Send + Sync + 'static {
    fn status(
        &self,
        action_id: Uuid,
    ) -> impl Future<Output = Result<Option<WebhookInfo>, Report>> + Send;

    /// Set the routine's hook id and secret hash, replacing any it had,
    /// while its event filters watch its webhook; false when they don't.
    fn replace(
        &self,
        action_id: Uuid,
        hook_id: HookId,
        secret_hash: SecretHash,
        created_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;

    /// False when it had none.
    fn remove(&self, action_id: Uuid) -> impl Future<Output = Result<bool, Report>> + Send;

    fn find(
        &self,
        hook_id: HookId,
    ) -> impl Future<Output = Result<Option<StoredHook>, Report>> + Send;

    /// Under the routine's lock: recheck the hook, its secret and the
    /// filter, answer a repeated key, refuse a paused routine, a body its
    /// filters don't match or a full queue, then queue the delivery at the
    /// routine's current revision.
    fn admit(
        &self,
        admission: WebhookAdmission,
    ) -> impl Future<Output = Result<AdmissionOutcome, Report>> + Send;
}

/// What a request is counted against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LimitScope {
    Address(IpAddr),
    /// Requests without an address share one count.
    NoAddress,
    Hook(HookId),
}

/// Fixed-window request counts every replica shares.
pub trait WebhookLimits: Send + Sync + 'static {
    /// Count a request; `Some(retry_after)` when it is over the limit.
    fn count(
        &self,
        scope: LimitScope,
        limit: Limit,
    ) -> impl Future<Output = Result<Option<Duration>, Report>> + Send;
}

/// Managing and receiving routine webhooks.
pub struct RoutineWebhooks<R, S, L> {
    repo: std::sync::Arc<R>,
    store: S,
    limits: L,
}

impl<R, S, L> RoutineWebhooks<R, S, L> {
    pub fn new(repo: std::sync::Arc<R>, store: S, limits: L) -> Self {
        Self {
            repo,
            store,
            limits,
        }
    }
}

impl<R: ScheduledActionRepo, S: WebhookStore, L: WebhookLimits> RoutineWebhooks<R, S, L> {
    /// The routine, when the caller is its owner in person.
    async fn owned(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
        caller: ManagingCaller,
    ) -> Result<super::models::ScheduledAction, WebhookManagementError> {
        if caller == ManagingCaller::Agent || receipt.get_authenticated_user().is_err() {
            return Err(WebhookManagementError::NotOwnerInPerson);
        }
        let action = granted_action(self.repo.as_ref(), receipt)
            .await
            .map_err(|error| match error.downcast_ref::<ActionPolicyError>() {
                Some(ActionPolicyError::NotFound) => WebhookManagementError::NotFound,
                _ => WebhookManagementError::Internal(rootcause::report!("{error:#}")),
            })?;
        let owner = receipt
            .get_authenticated_user()
            .map_err(|_| WebhookManagementError::NotOwnerInPerson)?;
        if !action.owner.is_user(owner) {
            return Err(WebhookManagementError::NotOwnerInPerson);
        }
        Ok(action)
    }

    async fn limit(&self, scope: LimitScope, limit: Limit) -> Result<(), DeliveryError> {
        match self.limits.count(scope, limit).await {
            Ok(None) => Ok(()),
            Ok(Some(retry_after)) => Err(DeliveryError::TooManyRequests { retry_after }),
            Err(error) => Err(DeliveryError::Unavailable(error)),
        }
    }

    /// Check a POST and queue its run. Every refusal of the URL itself is
    /// [`DeliveryError::NotFound`], after the same lookup and comparison.
    async fn deliver(&self, request: DeliveryRequest<'_>) -> Result<Delivered, DeliveryError> {
        let span = tracing::Span::current();
        let address = request
            .address
            .map_or(LimitScope::NoAddress, LimitScope::Address);
        self.limit(address, ADDRESS_LIMIT).await?;
        let idempotency_key = request
            .idempotency_key
            .map(IdempotencyKey::try_from)
            .transpose()?;
        let body = body_text(request.body)?;
        let hook_id = Uuid::parse_str(request.hook_id).ok().map(HookId::from);
        let stored = match hook_id {
            Some(hook_id) => self
                .store
                .find(hook_id)
                .await
                .map_err(DeliveryError::Unavailable)?,
            None => None,
        };
        // Headers and paths are bounded by the HTTP server, so any length is
        // cheap to hash.
        let presented = SecretHash::of(request.secret);
        let expected = stored.map_or(NO_HOOK_HASH, |hook| hook.secret_hash);
        let matched = presented.matches(&expected);
        let (Some(hook_id), Some(stored), true) = (hook_id, stored, matched) else {
            return Err(DeliveryError::NotFound);
        };
        span.record("hook_id", tracing::field::display(hook_id));
        span.record("action_id", tracing::field::display(stored.action_id));
        self.limit(LimitScope::Hook(hook_id), HOOK_LIMIT).await?;
        let event_id = EventId::try_from(generate_uuid_v7())
            .map_err(|error| DeliveryError::Unavailable(Report::new(error).into_dynamic()))?;
        let event = EventReference::webhook(
            event_id,
            WebhookDelivery::new(hook_id, body, request.content_type, idempotency_key),
        );
        let outcome = self
            .store
            .admit(WebhookAdmission {
                action_id: stored.action_id,
                hook_id,
                secret_hash: presented,
                event,
                repeat_since: Utc::now() - IDEMPOTENCY_WINDOW,
                max_queued: MAX_QUEUED,
            })
            .await
            .map_err(DeliveryError::Unavailable)?;
        let delivered = match outcome {
            AdmissionOutcome::Admitted => Delivered::Started {
                run_id: event_id.as_uuid(),
            },
            AdmissionOutcome::Repeated { run_id } => Delivered::Repeated { run_id },
            AdmissionOutcome::Unmatched => return Ok(Delivered::Unmatched),
            AdmissionOutcome::Paused => return Err(DeliveryError::Paused),
            AdmissionOutcome::Full => {
                return Err(DeliveryError::Busy {
                    retry_after: HOOK_LIMIT.window,
                });
            }
            AdmissionOutcome::Revoked => return Err(DeliveryError::NotFound),
        };
        if let Delivered::Started { run_id } | Delivered::Repeated { run_id } = delivered {
            span.record("run_id", tracing::field::display(run_id));
        }
        Ok(delivered)
    }
}

/// Managing and receiving routine webhooks, for the HTTP adapter.
pub trait RoutineWebhookService: Send + Sync + 'static {
    fn status(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
        caller: ManagingCaller,
    ) -> impl Future<Output = Result<Option<WebhookInfo>, WebhookManagementError>> + Send;

    /// A new URL for the routine, replacing any it had.
    fn mint(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
        caller: ManagingCaller,
    ) -> impl Future<Output = Result<MintedWebhook, WebhookManagementError>> + Send;

    /// Revoke the routine's URL; false when it had none.
    fn remove(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
        caller: ManagingCaller,
    ) -> impl Future<Output = Result<bool, WebhookManagementError>> + Send;

    /// Check a POST and queue its run.
    fn receive(
        &self,
        request: DeliveryRequest<'_>,
    ) -> impl Future<Output = Result<Delivered, DeliveryError>> + Send;
}

impl<R: ScheduledActionRepo, S: WebhookStore, L: WebhookLimits> RoutineWebhookService
    for RoutineWebhooks<R, S, L>
{
    #[tracing::instrument(name = "routine.webhook.status", skip_all, err)]
    async fn status(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
        caller: ManagingCaller,
    ) -> Result<Option<WebhookInfo>, WebhookManagementError> {
        let action = self.owned(receipt, caller).await?;
        let id = action.id.ok_or(WebhookManagementError::NotFound)?;
        self.store
            .status(id)
            .await
            .map_err(WebhookManagementError::Internal)
    }

    /// A new URL for the routine, replacing any it had.
    #[tracing::instrument(name = "routine.webhook.mint", skip_all, err, fields(
        action_id = tracing::field::Empty,
        hook_id = tracing::field::Empty,
        rotated = tracing::field::Empty,
    ))]
    async fn mint(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
        caller: ManagingCaller,
    ) -> Result<MintedWebhook, WebhookManagementError> {
        let action = self.owned(receipt, caller).await?;
        let id = action.id.ok_or(WebhookManagementError::NotFound)?;
        let span = tracing::Span::current();
        span.record("action_id", tracing::field::display(id));
        if !action.trigger.has_webhook() {
            return Err(WebhookManagementError::NoWebhookTrigger);
        }
        let rotated = self
            .store
            .status(id)
            .await
            .map_err(WebhookManagementError::Internal)?
            .is_some();
        let hook_id = HookId::generate();
        let secret = WebhookSecret::generate();
        let created_at = Utc::now();
        let saved = self
            .store
            .replace(id, hook_id, secret.hash(), created_at)
            .await
            .map_err(WebhookManagementError::Internal)?;
        if !saved {
            return Err(WebhookManagementError::NoWebhookTrigger);
        }
        span.record("hook_id", tracing::field::display(hook_id));
        span.record("rotated", rotated);
        Ok(MintedWebhook {
            hook_id,
            secret,
            created_at,
        })
    }

    /// Revoke the routine's URL; its filter stays until the routine is saved
    /// without it.
    #[tracing::instrument(name = "routine.webhook.remove", skip_all, err)]
    async fn remove(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
        caller: ManagingCaller,
    ) -> Result<bool, WebhookManagementError> {
        let action = self.owned(receipt, caller).await?;
        let id = action.id.ok_or(WebhookManagementError::NotFound)?;
        self.store
            .remove(id)
            .await
            .map_err(WebhookManagementError::Internal)
    }

    #[tracing::instrument(name = "routine.webhook.receive", skip_all, fields(
        body_bytes = request.body.len(),
        hook_id = tracing::field::Empty,
        action_id = tracing::field::Empty,
        run_id = tracing::field::Empty,
        outcome = tracing::field::Empty,
    ))]
    async fn receive(&self, request: DeliveryRequest<'_>) -> Result<Delivered, DeliveryError> {
        let result = self.deliver(request).await;
        let outcome = match &result {
            Ok(Delivered::Started { .. }) => "started",
            Ok(Delivered::Repeated { .. }) => "repeated",
            Ok(Delivered::Unmatched) => "unmatched",
            Err(DeliveryError::NotFound) => "not_found",
            Err(DeliveryError::TooManyRequests { .. }) => "rate_limited",
            Err(DeliveryError::TooLarge) => "too_large",
            Err(DeliveryError::NotText) => "not_text",
            Err(DeliveryError::InvalidIdempotencyKey) => "invalid_key",
            Err(DeliveryError::Paused) => "paused",
            Err(DeliveryError::Busy { .. }) => "busy",
            Err(DeliveryError::Unavailable(error)) => {
                tracing::error!(error = ?error, "routine webhook unavailable");
                "unavailable"
            }
        };
        tracing::Span::current().record("outcome", outcome);
        result
    }
}
