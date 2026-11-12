//! Connection lifecycle policy independent of HTTP, PostgreSQL and KMS.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use codex_cloud_agents::domain::cloud::CloudId;
use codex_cloud_agents::domain::{Credentials, Environment, Secret};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

mod service;
pub use service::ConnectionServiceImpl;

/// Errors contain no credentials or provider response bodies.
#[derive(Debug, thiserror::Error)]
pub enum ConnectionError {
    /// An operation requires an existing connection.
    #[error("connect Codex first")]
    NotConnected,
    /// Input cannot be accepted safely.
    #[error("invalid Codex connection input")]
    InvalidInput,
    /// The requested login attempt does not belong to this user or no longer exists.
    #[error("Codex login attempt not found")]
    NotFound,
    /// Account replacement requires explicit disconnect.
    #[error("Codex is already connected; disconnect before switching accounts")]
    AlreadyConnected,
    /// Provider access failed without revealing the underlying response.
    #[error("Codex is unavailable or authorization expired; reconnect if this persists")]
    Provider,
    /// A refresh must preserve the account to which the connection was bound.
    #[error("Codex account changed during refresh; reconnect")]
    AccountChanged,
    /// Persistence failed.
    #[error("could not persist Codex connection")]
    Storage,
    /// Envelope encryption or decryption failed.
    #[error("could not encrypt or decrypt Codex connection")]
    Encryption,
}

/// Safe connection metadata displayed in settings.
pub struct ConnectionStatus {
    /// Whether usable credentials are stored.
    pub connected: bool,
    /// Provider account identity, never a token.
    pub account_id: Option<String>,
    /// Selected environment, if configured.
    pub environment_id: Option<String>,
}

/// Information needed to complete device authorization in the browser.
pub struct StartedLogin {
    /// Owner-bound attempt identity.
    pub attempt_id: Uuid,
    /// Official provider device verification URL.
    pub verification_url: String,
    /// Short, expiring user code; never log this value.
    pub user_code: String,
    /// Absolute deadline.
    pub expires_at: DateTime<Utc>,
    /// Minimum interval between polling requests.
    pub poll_interval_seconds: u64,
}

/// Durable device authorization outcome.
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LoginStatus {
    /// Waiting for browser authorization.
    Pending,
    /// Credentials were atomically saved.
    Connected,
    /// Attempt deadline passed.
    Expired,
    /// Provider rejected the attempt; begin again.
    Failed,
}

/// Fresh owner credentials and the exact target a session must pin.
pub struct ResolvedConnection {
    /// New UUID for each successful connection, invalidating old bindings on reconnect.
    pub connection_id: Uuid,
    /// Current OAuth credentials; the caller must not retain them across operations.
    pub credentials: Credentials,
    /// Validated remote environment identity.
    pub environment_id: Option<CloudId>,
}

/// Owning service boundary used by auth handlers and cloud session runtimes.
#[async_trait]
pub trait ConnectionService: Send + Sync {
    /// Read safe connection metadata.
    async fn status(&self, owner: &str) -> Result<ConnectionStatus, ConnectionError>;
    /// Begin one durable owner-bound device authorization.
    async fn start_login(&self, owner: &str) -> Result<StartedLogin, ConnectionError>;
    /// Poll only the caller's current attempt and respect the provider interval.
    async fn poll_login(&self, owner: &str, attempt: Uuid) -> Result<LoginStatus, ConnectionError>;
    /// Cancel only a matching pending attempt.
    async fn cancel_login(&self, owner: &str, attempt: Uuid) -> Result<(), ConnectionError>;
    /// Delete credentials and invalidate pending attempts and prior session bindings.
    async fn disconnect(&self, owner: &str) -> Result<(), ConnectionError>;
    /// List environments using freshly rotated credentials.
    async fn environments(&self, owner: &str) -> Result<Vec<Environment>, ConnectionError>;
    /// Select a visible environment for subsequent sessions.
    async fn configure(
        &self,
        owner: &str,
        environment: &str,
    ) -> Result<ConnectionStatus, ConnectionError>;
    /// Resolve an authenticated connection, serializing refresh across service replicas.
    async fn resolve(&self, owner: &str) -> Result<ResolvedConnection, ConnectionError>;
}

/// Sensitive durable state; repository adapters must encrypt the entire serialized value.
#[derive(Default, Serialize, Deserialize)]
pub struct ConnectionState {
    /// The current completed connection, if any.
    pub connection: Option<StoredConnection>,
    /// Only the latest authorization attempt can become a connection.
    pub attempt: Option<LoginAttempt>,
}
/// Encrypted completed connection payload.
#[derive(Serialize, Deserialize)]
pub struct StoredConnection {
    /// Identity changes whenever an account reconnects.
    pub id: Uuid,
    /// Full provider tokens, never stored unencrypted.
    pub credentials: Credentials,
    /// Optional until the user chooses an environment.
    pub environment_id: Option<String>,
}
/// Encrypted device flow state; terminal attempts contain no device secret.
#[derive(Serialize, Deserialize)]
pub struct LoginAttempt {
    /// Owner-scoped attempt identity.
    pub id: Uuid,
    /// Current lifecycle outcome.
    pub status: LoginStatus,
    /// Deadline after which polling cannot exchange credentials.
    pub expires_at: DateTime<Utc>,
    /// Next allowed provider poll, enforced under the owner transaction lock.
    pub next_poll_at: DateTime<Utc>,
    /// Provider's minimum poll period.
    pub interval_seconds: u64,
    /// Cleared immediately on termination.
    pub device: Option<DeviceState>,
}
/// Sensitive device values needed for a later provider poll.
#[derive(Serialize, Deserialize)]
pub struct DeviceState {
    /// Provider's private poll handle.
    pub device_auth_id: Secret,
    /// Expiring browser code, encrypted alongside the handle.
    pub user_code: String,
    /// Fixed official verification URL returned at initiation.
    pub verification_url: String,
}

/// Repository lock spans credential reads, provider rotation and durable writes.
#[async_trait]
pub trait ConnectionRepository: Send + Sync {
    /// Acquire an exclusive per-owner lock across replicas and read decrypted state.
    async fn lock(&self, owner: &str) -> Result<Box<dyn ConnectionTransaction>, ConnectionError>;
}
/// Exclusive owner transaction; dropping it releases its lock and rolls back writes.
#[async_trait]
pub trait ConnectionTransaction: Send {
    /// Read the state loaded while acquiring the exclusive lock.
    fn state(&mut self) -> &mut ConnectionState;
    /// Atomically encrypt, write and commit the current state before releasing the lock.
    async fn commit(self: Box<Self>) -> Result<(), ConnectionError>;
}

/// Versioned authenticated envelope; only ciphertext is serializable outside domain state.
#[derive(Serialize, Deserialize)]
pub struct EncryptedState {
    /// Envelope format version.
    pub version: u8,
    /// AES-GCM payload ciphertext and tag.
    pub ciphertext: Vec<u8>,
    /// KMS-wrapped fresh AES data key.
    pub encrypted_data_key: Vec<u8>,
    /// Fresh random 96-bit AES-GCM nonce.
    pub nonce: Vec<u8>,
    /// CMK ARN returned by KMS.
    pub kms_key_id: String,
}
/// Cipher boundary binds every envelope to purpose and owner.
#[async_trait]
pub trait StateCipher: Send + Sync {
    /// Encrypt state without retaining plaintext bytes.
    async fn encrypt(
        &self,
        owner: &str,
        state: &ConnectionState,
    ) -> Result<EncryptedState, ConnectionError>;
    /// Decrypt only an envelope authenticated for this owner and feature.
    async fn decrypt(
        &self,
        owner: &str,
        envelope: &EncryptedState,
    ) -> Result<ConnectionState, ConnectionError>;
}
