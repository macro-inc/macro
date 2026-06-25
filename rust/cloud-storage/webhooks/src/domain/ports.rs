//! Port traits the webhook service depends on, plus the records exchanged with
//! them. Adapters live in [`crate::outbound`].

use std::future::Future;

use crate::domain::{
    ids::{WebhookId, WebhookRuleId},
    model::{Webhook, WebhookStatus},
    rule::RuleDefinition,
};

/// Persistence port for webhooks and their single rule.
///
/// Implementations never return the stored signing secret; it is write-only
/// from the service's perspective (handed back to the caller exactly once at
/// creation time and otherwise only decrypted at delivery, which is out of
/// scope for V1).
pub trait WebhookRepository: Clone + Send + Sync + 'static {
    /// Atomically insert a webhook and its rule, returning the created
    /// [`Webhook`] (with its rule populated, without the secret).
    fn create_webhook_with_rule(
        &self,
        record: NewWebhookRecord,
    ) -> impl Future<Output = Result<Webhook, WebhookRepoError>> + Send;

    /// Load a webhook (with its rule) by id, scoped to a workspace. Returns
    /// `None` if it does not exist, is soft-deleted, or belongs to another
    /// workspace.
    fn get_webhook(
        &self,
        workspace_id: &str,
        webhook_id: &WebhookId,
    ) -> impl Future<Output = Result<Option<Webhook>, WebhookRepoError>> + Send;

    /// Apply a partial update to a webhook's own columns. Returns the updated
    /// [`Webhook`] (with its current rule populated).
    fn update_webhook(
        &self,
        webhook_id: &WebhookId,
        patch: WebhookFieldsPatch,
    ) -> impl Future<Output = Result<Webhook, WebhookRepoError>> + Send;

    /// Replace the webhook's single rule (V1 has exactly one rule per webhook).
    fn replace_rule(
        &self,
        webhook_id: &WebhookId,
        record: NewRuleRecord,
    ) -> impl Future<Output = Result<Webhook, WebhookRepoError>> + Send;
}

/// Validates outbound endpoint URLs (scheme, host, and — at DNS-resolution
/// time — that the host does not resolve to a private/internal address).
///
/// See `webhooks_plan.md` "Endpoint Validation"; the V1 SSRF posture (no
/// connection-time IP pinning / redirect re-validation) is an accepted risk.
pub trait EndpointValidator: Clone + Send + Sync + 'static {
    /// Validate a candidate endpoint URL, rejecting unsafe destinations.
    fn validate(
        &self,
        url: &str,
    ) -> impl Future<Output = Result<(), EndpointValidationError>> + Send;
}

/// Generates and encrypts/decrypts webhook signing secrets and custom headers
/// at rest (KMS-backed in production; AES-256-GCM in V1).
pub trait SecretEncryptor: Clone + Send + Sync + 'static {
    /// Generate a fresh signing secret (the user-facing `whsec_…` value).
    fn generate_secret(&self) -> String;

    /// Encrypt plaintext for storage.
    fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, EncryptionError>;

    /// Decrypt previously [`Self::encrypt`]ed ciphertext.
    fn decrypt(&self, ciphertext: &[u8]) -> Result<Vec<u8>, EncryptionError>;
}

/// A webhook plus its rule, ready to be inserted.
#[derive(Debug, Clone)]
pub struct NewWebhookRecord {
    /// Generated webhook id.
    pub id: WebhookId,
    /// Owning workspace (tenant boundary).
    pub workspace_id: String,
    /// The user that owns the webhook, if any.
    pub owner_user_id: Option<String>,
    /// Human-readable name.
    pub name: String,
    /// Validated endpoint URL.
    pub endpoint_url: String,
    /// Encrypted signing secret (always present).
    pub secret_encrypted: Vec<u8>,
    /// Encrypted JSON object of custom headers, if any.
    pub headers_encrypted: Option<Vec<u8>>,
    /// The user that created the webhook.
    pub created_by_user_id: String,
    /// The webhook's single rule.
    pub rule: NewRuleRecord,
}

/// A rule ready to be inserted or to replace an existing one.
#[derive(Debug, Clone)]
pub struct NewRuleRecord {
    /// Generated rule id.
    pub id: WebhookRuleId,
    /// Owning workspace.
    pub workspace_id: String,
    /// Optional rule name.
    pub name: Option<String>,
    /// Whether the rule is enabled.
    pub enabled: bool,
    /// The validated rule definition (stored as JSONB).
    pub definition: RuleDefinition,
}

/// A partial update to a webhook's own columns. `None` fields are left unchanged.
#[derive(Debug, Clone, Default)]
pub struct WebhookFieldsPatch {
    /// New name.
    pub name: Option<String>,
    /// New (already validated) endpoint URL.
    pub endpoint_url: Option<String>,
    /// New status.
    pub status: Option<WebhookStatus>,
    /// New encrypted signing secret (set on rotation).
    pub secret_encrypted: Option<Vec<u8>>,
    /// New encrypted headers (replaces the stored headers).
    pub headers_encrypted: Option<Vec<u8>>,
}

/// Errors raised by the persistence port.
#[derive(Debug, thiserror::Error)]
pub enum WebhookRepoError {
    /// The targeted webhook does not exist (or is not visible to the caller).
    #[error("webhook not found")]
    NotFound,
    /// A uniqueness/state conflict (e.g. duplicate rule for a webhook).
    #[error("conflict: {0}")]
    Conflict(String),
    /// Any other storage-layer failure.
    #[error("storage error: {0}")]
    Storage(#[from] anyhow::Error),
}

/// Errors raised while validating an endpoint URL.
#[derive(Debug, thiserror::Error)]
pub enum EndpointValidationError {
    /// The URL could not be parsed.
    #[error("endpoint url is malformed: {0}")]
    Malformed(String),
    /// The URL does not use `https`.
    #[error("endpoint url must use https")]
    NotHttps,
    /// The host is missing, `localhost`, or a known-internal domain.
    #[error("endpoint host is not allowed")]
    HostNotAllowed,
    /// The host resolves to a private/link-local/metadata address.
    #[error("endpoint resolves to a private or internal address")]
    PrivateAddress,
    /// The port is not in the allowed set.
    #[error("endpoint port is not allowed")]
    PortNotAllowed,
    /// The host could not be resolved.
    #[error("endpoint host could not be resolved")]
    Unresolvable,
}

/// Errors raised by the secret encryptor.
#[derive(Debug, thiserror::Error)]
pub enum EncryptionError {
    /// Encryption failed.
    #[error("failed to encrypt secret material")]
    Encrypt,
    /// Decryption failed (wrong key, corrupt ciphertext, …).
    #[error("failed to decrypt secret material")]
    Decrypt,
}
