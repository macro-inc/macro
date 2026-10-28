//! Shared preview records. A preview ID is also its generation fence.
use super::{Preview, PreviewError, PreviewId, PreviewStatus};
use agent_fold::domain::log::AgentSessionId;
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use uuid::Uuid;

/// Durable metadata; never contains a live tunnel or plaintext credential.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredPreview {
    /// Public snapshot.
    pub preview: Preview,
    /// Account charged for this preview.
    pub user: MacroUserIdStr<'static>,
    /// Agent's local HTTP port.
    pub port: u16,
    /// Replica which atomically claimed the SSH credential, if connected.
    pub replica: Option<Uuid>,
}
/// Hash-only credential record, scoped to one preview generation.
#[derive(Clone)]
pub struct StoredCredential {
    /// Credential digest.
    pub hash: [u8; 32],
    /// Preview generation.
    pub preview: PreviewId,
    /// Viewer identity; absent for an SSH token.
    pub user: Option<MacroUserIdStr<'static>>,
    /// Unix milliseconds deadline.
    pub expires: i64,
}
/// Credential use, kept distinct so browser cookies cannot authenticate SSH.
#[derive(Clone, Copy)]
pub enum CredentialKind {
    /// One-use agent SSH credential.
    Ssh,
    /// One-use browser handoff.
    Ticket,
    /// Reusable, host-bound browser cookie.
    Browser,
}
impl CredentialKind {
    /// Persisted vocabulary.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ssh => "ssh",
            Self::Ticket => "ticket",
            Self::Browser => "browser",
        }
    }
}
/// Creation policy supplied by the domain, enforced atomically by storage.
#[derive(Clone, Copy)]
pub struct CreationLimits {
    /// Retained, unexpired previews across all replicas.
    pub total: i64,
    /// Active previews charged to one account.
    pub account: i64,
    /// Minimum delay between shares for one account.
    pub pace_seconds: f64,
}
impl CreationLimits {
    /// Preview quota and pacing policy.
    pub const PREVIEW: Self = Self {
        total: 1000,
        account: 5,
        pace_seconds: 10.0,
    };
}
/// Bounded subscriber registry policy, supplied by the domain.
#[derive(Clone, Copy)]
pub struct WatchLimits {
    /// Maximum recently watched sessions.
    pub sessions: i64,
    /// Maximum viewers for one session.
    pub viewers: i64,
    /// Watcher expiry, Unix milliseconds.
    pub expires: i64,
}
/// Shared ownership and credential persistence. Every mutation is generation-fenced.
#[async_trait]
pub trait PreviewRepository: Send + Sync {
    /// Create/replace a session preview and its SSH credential, enforcing account budgets atomically.
    async fn create(
        &self,
        preview: StoredPreview,
        ssh: StoredCredential,
        limits: CreationLimits,
    ) -> Result<(), PreviewError>;
    /// Current preview for a session.
    async fn session(&self, session: AgentSessionId)
    -> Result<Option<StoredPreview>, PreviewError>;
    /// Resolve a current, unexpired preview generation.
    async fn preview(&self, id: &PreviewId) -> Result<StoredPreview, PreviewError>;
    /// Atomically consume SSH credential and claim the unowned preview for this live replica.
    async fn claim(&self, hash: [u8; 32], replica: Uuid) -> Result<StoredPreview, PreviewError>;
    /// Change status only if the generation and SSH owner still match.
    async fn status(
        &self,
        id: &PreviewId,
        replica: Uuid,
        status: PreviewStatus,
    ) -> Result<bool, PreviewError>;
    /// Stop the current generation; later readiness/cleanup cannot undo it.
    async fn stop(&self, session: AgentSessionId) -> Result<Option<StoredPreview>, PreviewError>;
    /// Store a hash-only ticket or browser credential for a live generation.
    async fn credential(
        &self,
        kind: CredentialKind,
        credential: StoredCredential,
        limit: i64,
    ) -> Result<(), PreviewError>;
    /// Read or atomically consume a host-bound credential. A wrong host never consumes it.
    async fn authenticate(
        &self,
        kind: CredentialKind,
        id: &PreviewId,
        hash: [u8; 32],
        consume: bool,
    ) -> Result<StoredCredential, PreviewError>;
    /// Heartbeat an authenticated, server-configured replica address. Expired replicas cannot revive old previews.
    async fn heartbeat(
        &self,
        replica: Uuid,
        address: SocketAddr,
        ttl_seconds: f64,
    ) -> Result<Vec<Preview>, PreviewError>;
    /// Resolve only live registered SSH owners; no client destination participates.
    async fn destination(&self, id: &PreviewId) -> Result<(Uuid, SocketAddr), PreviewError>;
    /// Track authorized subscribers for notifications across replicas.
    async fn watch(
        &self,
        session: AgentSessionId,
        user: &MacroUserIdStr<'_>,
        limits: WatchLimits,
    ) -> Result<(), PreviewError>;
    /// Recently authorized watchers, bounded by the repository.
    async fn watchers(
        &self,
        session: AgentSessionId,
        limit: i64,
    ) -> Result<Vec<MacroUserIdStr<'static>>, PreviewError>;
    /// Expire dead owners and reclaim credentials/leases/replicas.
    async fn sweep(&self) -> Result<Vec<Preview>, PreviewError>;
}
