use super::{
    PreviewId,
    ports::{Authority, Events, Tunnel},
};
use agent_fold::domain::log::AgentSessionId;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, EntityType, RequiredPermission, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

const LEASE: Duration = Duration::from_secs(3600);
const IDLE: Duration = Duration::from_secs(900);
const TOKEN_TTL: Duration = Duration::from_secs(120);
const TICKET_TTL: Duration = Duration::from_secs(30);

/// Authenticated agent identity, resolved from its session credential.
#[derive(Clone)]
pub struct AgentIdentity {
    /// Agent-session entity ID.
    pub session: AgentSessionId,
    /// Account whose preview quota is charged.
    pub owner: MacroUserIdStr<'static>,
}
/// Public state of one preview; contains no credentials.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    /// Opaque routing ID, not an authorization credential.
    pub id: PreviewId,
    /// Agent-session entity that controls visibility.
    pub agent_session_id: AgentSessionId,
    /// Clean HTTPS origin, with no application path prefix.
    pub url: String,
    /// Current state of the lease.
    pub status: PreviewStatus,
    /// Unix milliseconds at which this lease ends.
    pub expires_at: u64,
}
/// Preview lifecycle visible in the session UI.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreviewStatus {
    /// Waiting for SSH and a reachable HTTP server.
    Starting,
    /// HTTP traffic has successfully crossed the tunnel.
    Ready,
    /// The SSH connection closed.
    Offline,
    /// The time or idle lease elapsed.
    Expired,
    /// A user explicitly stopped sharing.
    Stopped,
}
/// A refusal at a preview boundary. Credentials are never included in errors.
#[derive(Debug, thiserror::Error)]
pub enum PreviewError {
    /// Invalid input.
    #[error("invalid preview request")]
    Invalid,
    /// Unknown, expired, revoked, or otherwise unauthorized credential.
    #[error("preview access denied")]
    Denied,
    /// No live preview for this session.
    #[error("preview is offline")]
    Offline,
    /// A resource quota was exceeded.
    #[error("preview resource limit reached")]
    Limited,
    /// An upstream or infrastructure failure.
    #[error("preview service unavailable")]
    Unavailable,
}
/// Deployment addresses and pinned SSH identity; validated on startup.
#[derive(Clone)]
pub struct Settings {
    /// DNS suffix used by per-preview hosts, without a wildcard.
    pub domain: String,
    /// HTTPS port (443 in production; configurable for local TLS).
    pub https_port: u16,
    /// Public SSH hostname.
    pub ssh_host: String,
    /// Public SSH port.
    pub ssh_port: u16,
    /// Optional local Docker endpoint when the host loopback address is unreachable.
    pub local_ssh_fallback: bool,
    /// Local-only public ingress: a Cloudflare quick-tunnel hostname carrying this
    /// SSH listener, for agents that run outside this machine entirely.
    pub ssh_proxy_host: Option<String>,
    /// OpenSSH public host key, algorithm and base64 blob.
    pub host_key: String,
    /// Allowed Macro application origin for browser ticket handoff.
    pub app_origin: String,
}
impl Settings {
    /// Reject invalid shell/host components and Macro's shared cookie domain.
    pub fn validate(&self) -> Result<(), PreviewError> {
        fn host(s: &str) -> bool {
            !s.is_empty()
                && s.len() < 254
                && s.split('.').all(|label| {
                    !label.is_empty()
                        && label.len() <= 63
                        && !label.starts_with('-')
                        && !label.ends_with('-')
                        && label
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                })
        }
        let key: Vec<_> = self.host_key.split_whitespace().collect();
        let app = url::Url::parse(&self.app_origin).map_err(|_| PreviewError::Invalid)?;
        let app_host = app.host_str().ok_or(PreviewError::Invalid)?;
        let local = self.domain == "preview.localhost"
            && (app.scheme() == "https" || (app.scheme() == "http" && app_host == "localhost"));
        if !host(&self.domain)
            || !host(&self.ssh_host)
            || self.ssh_port == 0
            || self.https_port == 0
            || self.domain == "macro.com"
            || self.domain.ends_with(".macro.com")
            || self.domain == app_host
            // Neither may sit under the other: every non-gateway cookie is
            // forwarded upstream, so a shared parent hands the app's cookies to
            // agent-controlled code. The local stack is the deliberate exception
            // (`preview.localhost` under `localhost`), including the development
            // CA's HTTPS listener. Local stacks may also use a machine hostname.
            || app_host.ends_with(&format!(".{}", self.domain))
            || (!local && self.domain.ends_with(&format!(".{app_host}")))
            || (app.scheme() != "https" && !local)
            || (self.local_ssh_fallback && !local)
            || self
                .ssh_proxy_host
                .as_ref()
                .is_some_and(|proxy| !local || !host(proxy))
            || app.origin().ascii_serialization() != self.app_origin
            || key.len() != 2
            || key[0] != "ssh-ed25519"
            || base64::engine::general_purpose::STANDARD
                .decode(key[1])
                .is_err()
        {
            return Err(PreviewError::Invalid);
        }
        Ok(())
    }
    /// Public origin for a routing ID.
    pub fn origin(&self, id: &PreviewId) -> String {
        let port = if self.https_port == 443 {
            String::new()
        } else {
            format!(":{}", self.https_port)
        };
        format!("https://{id}.{}{port}", self.domain)
    }
}
/// Credentials returned only to the authenticated agent's tool call.
pub struct Share {
    /// State initially shown as waiting for connection.
    pub preview: Preview,
    /// Single-use SSH username. Do not log it.
    pub token: String,
    /// Local port the agent requested.
    pub port: u16,
}
/// Browser handoff, posted to the preview origin without touching app URLs.
#[derive(Serialize)]
pub struct Launch {
    /// Cross-origin form action.
    pub action: String,
    /// One-use, 30-second ticket. Do not log it.
    pub ticket: String,
}
/// Live lease, with cancellation and stream slots shared by every request/upgrade.
pub struct Lease {
    preview: Mutex<Preview>,
    port: u16,
    expires: Instant,
    activity: Mutex<Instant>,
    tunnel: Mutex<Option<Arc<dyn Tunnel>>>,
    pending_cleanup: AtomicBool,
    /// Cancellation closes existing HTTP and WebSocket traffic on revocation.
    pub cancel: CancellationToken,
    /// Total HTTP streams, held until response completion.
    pub requests: Arc<Semaphore>,
    /// Upgraded streams, separately capped.
    pub upgrades: Arc<Semaphore>,
}
impl Lease {
    /// Snapshot with no credentials.
    pub fn preview(&self) -> Preview {
        self.preview.lock().expect("preview mutex").clone()
    }
    /// Original local port for generic Host rewriting.
    pub fn port(&self) -> u16 {
        self.port
    }
    /// Check hard and idle deadlines even between sweeper ticks.
    pub fn live(&self) -> bool {
        !self.cancel.is_cancelled()
            && Instant::now() < self.expires
            && self.activity.lock().expect("activity mutex").elapsed() < IDLE
    }
    /// Registered tunnel capability.
    pub fn tunnel(&self) -> Result<Arc<dyn Tunnel>, PreviewError> {
        if !self.live() {
            return Err(PreviewError::Offline);
        }
        self.tunnel
            .lock()
            .expect("tunnel mutex")
            .clone()
            .ok_or(PreviewError::Offline)
    }
}
/// Core use cases. Durable metadata is shared; only SSH transports live locally.
#[derive(Clone)]
pub struct PreviewService {
    settings: Arc<Settings>,
    authority: Arc<dyn Authority>,
    events: Arc<dyn Events>,
    repository: Arc<dyn super::storage::PreviewRepository>,
    replica: uuid::Uuid,
    peers: Arc<dyn super::ports::PeerConnector>,
    lifecycle: Arc<tokio::sync::Mutex<()>>,
    peer_slots: Arc<Semaphore>,
    peer_upgrades: Arc<Semaphore>,
    leases: Arc<Mutex<HashMap<AgentSessionId, Arc<Lease>>>>,
}
use super::storage::{CredentialKind, StoredCredential, StoredPreview};
impl PreviewService {
    /// Compose a replica with shared ownership and credential persistence.
    pub fn new(
        settings: Settings,
        authority: Arc<dyn Authority>,
        events: Arc<dyn Events>,
        repository: Arc<dyn super::storage::PreviewRepository>,
        replica: uuid::Uuid,
        peers: Arc<dyn super::ports::PeerConnector>,
    ) -> Result<Self, PreviewError> {
        settings.validate()?;
        Ok(Self {
            settings: Arc::new(settings),
            authority,
            events,
            repository,
            replica,
            peers,
            lifecycle: Arc::new(tokio::sync::Mutex::new(())),
            peer_slots: Arc::new(Semaphore::new(1024)),
            peer_upgrades: Arc::new(Semaphore::new(128)),
            leases: Arc::new(Mutex::new(HashMap::new())),
        })
    }
    /// Deployment settings for transport adapters.
    pub fn settings(&self) -> &Settings {
        &self.settings
    }
    /// Publish a server-configured peer endpoint. Never accepts request input.
    #[tracing::instrument(skip_all, fields(replica = %self.replica), err)]
    pub async fn heartbeat(&self, address: std::net::SocketAddr) -> Result<(), PreviewError> {
        validate_peer(address)?;
        for preview in self
            .repository
            .heartbeat(self.replica, address, 45.0)
            .await?
        {
            self.publish(&preview).await;
        }
        Ok(())
    }
    /// Resolve an SSH owner using only the shared registry. None means local.
    #[tracing::instrument(skip_all, fields(preview_id = %id), err)]
    pub async fn destination(
        &self,
        id: &PreviewId,
    ) -> Result<Option<std::net::SocketAddr>, PreviewError> {
        let (replica, address) = self.repository.destination(id).await?;
        validate_peer(address)?;
        Ok((replica != self.replica).then_some(address))
    }
    /// Open one direct hop; even forged hop markers can only cause refusal, never bypass auth.
    #[tracing::instrument(skip_all, fields(preview_id = %id), err)]
    pub async fn peer_stream(
        &self,
        id: &PreviewId,
        forwarded: bool,
        upgrade: bool,
    ) -> Result<Option<super::ports::PeerConnection>, PreviewError> {
        if let Some(address) = self.destination(id).await? {
            if forwarded {
                return Err(PreviewError::Offline);
            }
            let permit = Arc::new(
                self.peer_slots
                    .clone()
                    .try_acquire_owned()
                    .map_err(|_| PreviewError::Limited)?,
            );
            let upgrade_permit = if upgrade {
                Some(
                    self.peer_upgrades
                        .clone()
                        .try_acquire_owned()
                        .map_err(|_| PreviewError::Limited)?,
                )
            } else {
                None
            };
            let stream = self.peers.connect(address).await?;
            return Ok(Some(super::ports::PeerConnection {
                stream,
                permit,
                upgrade_permit,
            }));
        }
        Ok(None)
    }
    /// Authenticate the existing agent-session credential.
    pub async fn agent(&self, token: &str) -> Result<AgentIdentity, PreviewError> {
        self.authority.agent(token).await
    }
    /// Replace one session preview. The new ID fences every previous transport.
    #[tracing::instrument(skip_all, fields(session_id = %identity.session), err)]
    pub async fn share(&self, identity: AgentIdentity, port: u16) -> Result<Share, PreviewError> {
        if port == 0 {
            return Err(PreviewError::Invalid);
        }
        self.authority.active(identity.session).await?;
        let lifecycle = self.lifecycle.lock().await;
        let id = PreviewId::generate();
        let token = format!("preview_{}", random());
        let preview = Preview {
            id: id.clone(),
            agent_session_id: identity.session,
            url: self.settings.origin(&id),
            status: PreviewStatus::Starting,
            expires_at: (now_ms() + LEASE.as_millis() as i64) as u64,
        };
        self.repository
            .create(
                StoredPreview {
                    preview: preview.clone(),
                    user: identity.owner,
                    port,
                    replica: None,
                },
                StoredCredential {
                    hash: digest(&token),
                    preview: id,
                    user: None,
                    expires: now_ms() + TOKEN_TTL.as_millis() as i64,
                },
                super::storage::CreationLimits::PREVIEW,
            )
            .await?;
        let old = self
            .leases
            .lock()
            .expect("leases mutex")
            .remove(&identity.session);
        drop(lifecycle);
        if let Some(old) = old {
            self.finish(&old, PreviewStatus::Stopped).await;
        }
        self.publish(&preview).await;
        Ok(Share {
            preview,
            token,
            port,
        })
    }
    /// Read shared state after an entity view receipt, and register a notification watcher.
    pub async fn get(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Option<Preview>, PreviewError> {
        let session = session_id(&receipt)?;
        if let Some(user) = receipt.acting_user_id() {
            self.repository
                .watch(
                    session,
                    user,
                    super::storage::WatchLimits {
                        sessions: 4096,
                        viewers: 256,
                        expires: now_ms() + 300000,
                    },
                )
                .await?;
        }
        Ok(self.repository.session(session).await?.map(|p| p.preview))
    }
    /// Entity edit permission stops the shared generation on any replica.
    #[tracing::instrument(skip_all, err)]
    pub async fn stop(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<(), PreviewError> {
        if let Some(stored) = self.repository.stop(session_id(&receipt)?).await? {
            let local = self
                .leases
                .lock()
                .expect("leases mutex")
                .get(&stored.preview.agent_session_id)
                .cloned();
            if let Some(lease) = local
                && lease.preview().id == stored.preview.id
            {
                self.finish(&lease, PreviewStatus::Stopped).await;
            }
            self.publish(&stored.preview).await;
        }
        Ok(())
    }
    /// Mint a shared, one-use, host-bound browser ticket after entity authorization.
    pub async fn launch(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Launch, PreviewError> {
        let user = receipt
            .get_authenticated_user()
            .map_err(|_| PreviewError::Denied)?
            .clone();
        let stored = self
            .repository
            .session(session_id(&receipt)?)
            .await?
            .ok_or(PreviewError::Offline)?;
        if stored.preview.status != PreviewStatus::Ready {
            return Err(PreviewError::Offline);
        }
        let ticket = random();
        self.repository
            .credential(
                CredentialKind::Ticket,
                StoredCredential {
                    hash: digest(&ticket),
                    preview: stored.preview.id,
                    user: Some(user),
                    expires: now_ms() + TICKET_TTL.as_millis() as i64,
                },
                4096,
            )
            .await?;
        Ok(Launch {
            action: format!("{}/.macro-preview/auth", stored.preview.url),
            ticket,
        })
    }
    /// Atomically consume SSH credentials and assign ownership to this accepting replica.
    #[tracing::instrument(skip_all, fields(replica = %self.replica, preview_id = tracing::field::Empty), err)]
    pub async fn authenticate_ssh(&self, token: &str) -> Result<Arc<Lease>, PreviewError> {
        let lifecycle = self.lifecycle.lock().await;
        let stored = self.repository.claim(digest(token), self.replica).await?;
        tracing::Span::current().record("preview_id", tracing::field::display(&stored.preview.id));
        let remaining = stored.preview.expires_at.saturating_sub(now_ms() as u64);
        let session = stored.preview.agent_session_id;
        let lease = Arc::new(Lease {
            preview: Mutex::new(stored.preview),
            port: stored.port,
            expires: Instant::now() + Duration::from_millis(remaining),
            activity: Mutex::new(Instant::now()),
            tunnel: Mutex::new(None),
            pending_cleanup: AtomicBool::new(false),
            cancel: CancellationToken::new(),
            requests: Arc::new(Semaphore::new(4096)),
            upgrades: Arc::new(Semaphore::new(8)),
        });
        let old = self
            .leases
            .lock()
            .expect("leases mutex")
            .insert(session, lease.clone());
        drop(lifecycle);
        if let Some(old) = old {
            self.finish(&old, PreviewStatus::Offline).await;
        }
        if let Err(error) = self.authority.active(session).await {
            self.finish(&lease, PreviewStatus::Offline).await;
            return Err(error);
        }
        // A replacement/stop racing the SSH handshake cannot install a live obsolete lease.
        if self.repository.preview(&lease.preview().id).await.is_err() {
            self.finish(&lease, PreviewStatus::Offline).await;
            return Err(PreviewError::Offline);
        }
        Ok(lease)
    }
    /// Accept one logical reverse forward, never an arbitrary socket destination.
    pub fn register(
        &self,
        lease: &Arc<Lease>,
        address: &str,
        port: u32,
        tunnel: Arc<dyn Tunnel>,
    ) -> Result<(), PreviewError> {
        if address != "127.0.0.1" || port != 1 || !lease.live() {
            return Err(PreviewError::Denied);
        }
        let mut current = lease.tunnel.lock().expect("tunnel mutex");
        if current.is_some() || !lease.live() {
            return Err(PreviewError::Denied);
        }
        *current = Some(tunnel);
        Ok(())
    }
    /// Publish readiness only if this generation is still owned and live.
    pub async fn ready(&self, lease: &Arc<Lease>) {
        if !lease.live() || lease.preview().status != PreviewStatus::Starting {
            return;
        }
        if !matches!(
            self.repository
                .status(&lease.preview().id, self.replica, PreviewStatus::Ready)
                .await,
            Ok(true)
        ) {
            self.finish(lease, PreviewStatus::Offline).await;
            return;
        }
        if lease.cancel.is_cancelled() {
            return;
        }
        let preview = {
            let mut preview = lease.preview.lock().expect("preview mutex");
            if !lease.live() || preview.status != PreviewStatus::Starting {
                return;
            }
            preview.status = PreviewStatus::Ready;
            preview.clone()
        };
        self.publish(&preview).await;
    }
    /// Close local transports unconditionally; shared cleanup matches generation and replica.
    pub async fn finish(&self, lease: &Arc<Lease>, status: PreviewStatus) {
        let preview = {
            let mut preview = lease.preview.lock().expect("preview mutex");
            lease.pending_cleanup.store(true, Ordering::SeqCst);
            if !lease.cancel.is_cancelled() {
                preview.status = status;
                lease.cancel.cancel();
            }
            preview.clone()
        };
        let tunnel = lease.tunnel.lock().expect("tunnel mutex").take();
        if let Some(tunnel) = tunnel {
            tunnel.close().await;
        }
        match self
            .repository
            .status(&preview.id, self.replica, preview.status)
            .await
        {
            Ok(changed) => {
                lease.pending_cleanup.store(false, Ordering::SeqCst);
                if changed {
                    self.publish(&preview).await;
                }
            }
            Err(error) => tracing::warn!(?error, "preview finish persistence failed"),
        }
    }
    /// Consume a shared ticket exactly once, after matching its preview origin.
    #[tracing::instrument(skip_all, fields(preview_id = %id), err)]
    pub async fn redeem(&self, id: &PreviewId, ticket: &str) -> Result<String, PreviewError> {
        let credential = self
            .repository
            .authenticate(CredentialKind::Ticket, id, digest(ticket), true)
            .await?;
        let user = credential.user.ok_or(PreviewError::Denied)?;
        let stored = self.repository.preview(id).await?;
        self.authority
            .viewer(stored.preview.agent_session_id, &user)
            .await?;
        let cookie = random();
        self.repository
            .credential(
                CredentialKind::Browser,
                StoredCredential {
                    hash: digest(&cookie),
                    preview: id.clone(),
                    user: Some(user),
                    expires: stored.preview.expires_at as i64,
                },
                8192,
            )
            .await?;
        Ok(cookie)
    }
    /// Recheck credentials, entity access, and the shared generation on every request/upgrade.
    #[tracing::instrument(skip_all, fields(preview_id = %id), err)]
    pub async fn viewer(
        &self,
        id: &PreviewId,
        cookie: &str,
        activity: bool,
    ) -> Result<Arc<Lease>, PreviewError> {
        let credential = self
            .repository
            .authenticate(CredentialKind::Browser, id, digest(cookie), false)
            .await?;
        let user = credential.user.ok_or(PreviewError::Denied)?;
        let stored = self.repository.preview(id).await?;
        if stored.replica != Some(self.replica) {
            return Err(PreviewError::Offline);
        }
        let lease = self.by_id(id)?;
        self.authority
            .viewer(stored.preview.agent_session_id, &user)
            .await?;
        if activity {
            *lease.activity.lock().expect("activity mutex") = Instant::now();
        }
        Ok(lease)
    }
    fn by_id(&self, id: &PreviewId) -> Result<Arc<Lease>, PreviewError> {
        self.leases
            .lock()
            .expect("leases mutex")
            .values()
            .find(|l| &l.preview().id == id && l.live())
            .cloned()
            .ok_or(PreviewError::Offline)
    }
    /// Check shared revocation and ownership, expire idle tunnels and reclaim state.
    pub async fn sweep(&self) {
        match self.repository.sweep().await {
            Ok(transitions) => {
                for preview in transitions {
                    self.publish(&preview).await;
                }
            }
            Err(error) => tracing::warn!(?error, "preview sweep failed"),
        }
        let leases: Vec<_> = self
            .leases
            .lock()
            .expect("leases mutex")
            .values()
            .cloned()
            .collect();
        for lease in leases {
            if lease.cancel.is_cancelled() && lease.pending_cleanup.load(Ordering::SeqCst) {
                self.finish(&lease, lease.preview().status).await;
            }
            if !lease.cancel.is_cancelled()
                && (!lease.live()
                    || self.repository.preview(&lease.preview().id).await.is_err()
                    || self
                        .authority
                        .active(lease.preview().agent_session_id)
                        .await
                        .is_err())
            {
                self.finish(&lease, PreviewStatus::Expired).await;
            }
        }
        self.leases
            .lock()
            .expect("leases mutex")
            .retain(|_, l| !l.cancel.is_cancelled() || l.pending_cleanup.load(Ordering::SeqCst));
    }
    async fn publish(&self, preview: &Preview) {
        // Never publish a stale generation/status after an awaited mutation or cleanup.
        let Ok(Some(current)) = self.repository.session(preview.agent_session_id).await else {
            return;
        };
        if current.preview.id != preview.id || current.preview.status != preview.status {
            return;
        }
        let mut candidates = self
            .repository
            .watchers(preview.agent_session_id, 256)
            .await
            .unwrap_or_default();
        candidates.push(current.user);
        candidates.sort_by(|a, b| a.as_ref().cmp(b.as_ref()));
        candidates.dedup();
        let mut viewers = Vec::new();
        for user in candidates {
            if self
                .authority
                .viewer(preview.agent_session_id, &user)
                .await
                .is_ok()
            {
                viewers.push(user);
            }
        }
        if let Err(error) = self.events.changed(preview, &viewers).await {
            tracing::warn!(?error, "preview notification failed");
        }
    }
}
/// Reject public, unspecified, multicast, and link-local peer targets (including metadata endpoints).
fn validate_peer(address: std::net::SocketAddr) -> Result<(), PreviewError> {
    let allowed = match address.ip() {
        std::net::IpAddr::V4(ip) => ip.is_private() || ip.is_loopback(),
        std::net::IpAddr::V6(ip) => ip.is_unique_local() || ip.is_loopback(),
    };
    if !allowed || address.port() == 0 {
        return Err(PreviewError::Invalid);
    }
    Ok(())
}
fn session_id<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<AgentSessionId, PreviewError> {
    let entity = receipt.entity();
    if entity.entity_type != EntityType::AgentSession {
        return Err(PreviewError::Denied);
    }
    entity.entity_id.parse().map_err(|_| PreviewError::Denied)
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn random() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
fn digest(value: &str) -> [u8; 32] {
    Sha256::digest(value.as_bytes()).into()
}
#[cfg(test)]
mod test;
