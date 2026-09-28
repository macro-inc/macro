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
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
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
#[derive(Clone, Serialize)]
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
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
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
        let local =
            self.domain == "preview.localhost" && app.scheme() == "http" && app_host == "localhost";
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
            // (`preview.localhost` under `localhost`), where the app origin is
            // cleartext loopback and sets nothing worth stealing.
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
struct Credential {
    preview: PreviewId,
    /// Absent on an SSH token: it authenticates the agent's tunnel, not a viewer.
    user: Option<MacroUserIdStr<'static>>,
    expires: Instant,
}
/// Per-owner creation pacing. Traffic itself is unmetered: a shared dev server
/// moves tens of MB per cold load, and every ceiling we tried severed it.
struct AccountBudget {
    last_created: Instant,
}
struct Registry {
    sessions: HashMap<AgentSessionId, Arc<Lease>>,
    accounts: HashMap<MacroUserIdStr<'static>, AccountBudget>,
    ssh_tokens: HashMap<[u8; 32], Credential>,
    tickets: HashMap<[u8; 32], Credential>,
    browsers: HashMap<[u8; 32], Credential>,
    watchers: HashMap<AgentSessionId, HashMap<MacroUserIdStr<'static>, Instant>>,
}
/// Live lease, with cancellation and stream slots shared by every request/upgrade.
pub struct Lease {
    preview: Mutex<Preview>,
    owner: MacroUserIdStr<'static>,
    port: u16,
    expires: Instant,
    activity: Mutex<Instant>,
    tunnel: Mutex<Option<Arc<dyn Tunnel>>>,
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
/// Core use cases; holds ephemeral leases because an SSH transport cannot survive a restart.
#[derive(Clone)]
pub struct PreviewService {
    settings: Arc<Settings>,
    authority: Arc<dyn Authority>,
    events: Arc<dyn Events>,
    registry: Arc<Mutex<Registry>>,
}
impl PreviewService {
    /// Wire authority and notifications around a single-replica registry.
    pub fn new(
        settings: Settings,
        authority: Arc<dyn Authority>,
        events: Arc<dyn Events>,
    ) -> Result<Self, PreviewError> {
        settings.validate()?;
        Ok(Self {
            settings: Arc::new(settings),
            authority,
            events,
            registry: Arc::new(Mutex::new(Registry {
                sessions: HashMap::new(),
                accounts: HashMap::new(),
                ssh_tokens: HashMap::new(),
                tickets: HashMap::new(),
                browsers: HashMap::new(),
                watchers: HashMap::new(),
            })),
        })
    }
    /// Deployment settings for the transport adapters.
    pub fn settings(&self) -> &Settings {
        &self.settings
    }
    /// Authenticate the existing agent session credential.
    pub async fn agent(&self, token: &str) -> Result<AgentIdentity, PreviewError> {
        self.authority.agent(token).await
    }
    /// Create one lease per session, replacing and closing any previous tunnel.
    pub async fn share(&self, identity: AgentIdentity, port: u16) -> Result<Share, PreviewError> {
        if port == 0 {
            return Err(PreviewError::Invalid);
        }
        self.authority.active(identity.session).await?;
        let id = PreviewId::generate();
        let token = random();
        let preview = Preview {
            id: id.clone(),
            agent_session_id: identity.session,
            url: self.settings.origin(&id),
            status: PreviewStatus::Starting,
            expires_at: (SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                + LEASE)
                .as_millis() as u64,
        };
        {
            let mut registry = self.registry.lock().expect("registry mutex");
            if registry.accounts.len() >= 1000 && !registry.accounts.contains_key(&identity.owner) {
                return Err(PreviewError::Limited);
            }
            let account = registry
                .accounts
                .entry(identity.owner.clone())
                .or_insert_with(|| AccountBudget {
                    last_created: Instant::now() - TOKEN_TTL,
                });
            if account.last_created.elapsed() < Duration::from_secs(10) {
                return Err(PreviewError::Limited);
            }
            account.last_created = Instant::now();
        }
        let lease = Arc::new(Lease {
            preview: Mutex::new(preview.clone()),
            owner: identity.owner,
            port,
            expires: Instant::now() + LEASE,
            activity: Mutex::new(Instant::now()),
            tunnel: Mutex::new(None),
            cancel: CancellationToken::new(),
            requests: Arc::new(Semaphore::new(512)),
            upgrades: Arc::new(Semaphore::new(8)),
        });
        let old = {
            let mut registry = self.registry.lock().expect("registry mutex");
            if registry.sessions.len() >= 1000 && !registry.sessions.contains_key(&identity.session)
            {
                return Err(PreviewError::Limited);
            }
            if registry
                .sessions
                .values()
                .filter(|l| {
                    l.owner == lease.owner
                        && l.live()
                        && l.preview().agent_session_id != identity.session
                })
                .count()
                >= 5
            {
                return Err(PreviewError::Limited);
            }
            if let Some(previous) = registry.sessions.get(&identity.session) {
                let old_id = previous.preview().id;
                registry.ssh_tokens.retain(|_, c| c.preview != old_id);
                registry.tickets.retain(|_, c| c.preview != old_id);
                registry.browsers.retain(|_, c| c.preview != old_id);
            }
            registry.ssh_tokens.insert(
                digest(&token),
                Credential {
                    preview: id,
                    user: None,
                    expires: Instant::now() + TOKEN_TTL,
                },
            );
            registry.sessions.insert(identity.session, lease)
        };
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
    /// Resolve a session's state only with an entity view receipt.
    pub fn get(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Option<Preview>, PreviewError> {
        let session = session_id(&receipt)?;
        let mut registry = self.registry.lock().expect("registry mutex");
        if let Some(user) = receipt.acting_user_id()
            && (registry.watchers.len() < 4096 || registry.watchers.contains_key(&session))
        {
            let watchers = registry.watchers.entry(session).or_default();
            if watchers.len() < 256 || watchers.contains_key(user) {
                watchers.insert(user.clone(), Instant::now());
            }
        }
        Ok(registry.sessions.get(&session).map(|l| l.preview()))
    }
    /// Stop requires entity edit permission; viewing never grants control.
    pub async fn stop(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<(), PreviewError> {
        let lease = self
            .registry
            .lock()
            .expect("registry mutex")
            .sessions
            .get(&session_id(&receipt)?)
            .cloned();
        if let Some(lease) = lease {
            self.finish(&lease, PreviewStatus::Stopped).await;
        }
        Ok(())
    }
    /// Mint a browser ticket after entity access was checked by the standard extractor.
    pub fn launch(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Launch, PreviewError> {
        let user = receipt
            .get_authenticated_user()
            .map_err(|_| PreviewError::Denied)?
            .clone();
        let mut registry = self.registry.lock().expect("registry mutex");
        let lease = registry
            .sessions
            .get(&session_id(&receipt)?)
            .cloned()
            .ok_or(PreviewError::Offline)?;
        if !lease.live() || lease.preview().status != PreviewStatus::Ready {
            return Err(PreviewError::Offline);
        }
        registry.tickets.retain(|_, c| c.expires > Instant::now());
        if registry.tickets.len() >= 4096 {
            return Err(PreviewError::Limited);
        }
        let ticket = random();
        let preview = lease.preview();
        registry.tickets.insert(
            digest(&ticket),
            Credential {
                preview: preview.id,
                user: Some(user),
                expires: Instant::now() + TICKET_TTL,
            },
        );
        Ok(Launch {
            action: format!("{}/.macro-preview/auth", preview.url),
            ticket,
        })
    }
    /// Redeem an SSH token exactly once; it is scoped to a single lease.
    pub fn authenticate_ssh(&self, token: &str) -> Result<Arc<Lease>, PreviewError> {
        let mut registry = self.registry.lock().expect("registry mutex");
        let credential = registry
            .ssh_tokens
            .remove(&digest(token))
            .ok_or(PreviewError::Denied)?;
        if credential.expires <= Instant::now() {
            return Err(PreviewError::Denied);
        }
        let lease = find(&registry, &credential.preview)?;
        if !lease.live() {
            return Err(PreviewError::Denied);
        }
        Ok(lease)
    }
    /// Accept exactly one logical reverse forward. No TCP listener is created.
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
        if current.is_some() {
            return Err(PreviewError::Denied);
        }
        *current = Some(tunnel);
        Ok(())
    }
    /// Mark ready only after receiving a real HTTP response through the tunnel.
    pub async fn ready(&self, lease: &Arc<Lease>) {
        let preview = {
            let mut preview = lease.preview.lock().expect("preview mutex");
            if preview.status != PreviewStatus::Starting || !lease.live() {
                return;
            }
            preview.status = PreviewStatus::Ready;
            preview.clone()
        };
        self.publish(&preview).await;
    }
    /// Mark disconnected/expired and cancel all current traffic.
    pub async fn finish(&self, lease: &Arc<Lease>, status: PreviewStatus) {
        if lease.cancel.is_cancelled() {
            return;
        }
        lease.cancel.cancel();
        let preview = {
            let mut preview = lease.preview.lock().expect("preview mutex");
            preview.status = status;
            preview.clone()
        };
        let tunnel = lease.tunnel.lock().expect("tunnel mutex").take();
        if let Some(tunnel) = tunnel {
            tunnel.close().await;
        }
        self.publish(&preview).await;
    }
    /// Exchange a host-bound, one-use ticket for a host-only browser credential.
    pub async fn redeem(&self, id: &PreviewId, ticket: &str) -> Result<String, PreviewError> {
        let credential = {
            let mut registry = self.registry.lock().expect("registry mutex");
            let credential = registry
                .tickets
                .get(&digest(ticket))
                .ok_or(PreviewError::Denied)?;
            if &credential.preview != id || credential.expires <= Instant::now() {
                return Err(PreviewError::Denied);
            }
            registry
                .tickets
                .remove(&digest(ticket))
                .ok_or(PreviewError::Denied)?
        };
        // A ticket is only ever minted for an authenticated viewer.
        let user = credential.user.ok_or(PreviewError::Denied)?;
        let lease = self.by_id(id)?;
        self.authority
            .viewer(lease.preview().agent_session_id, &user)
            .await?;
        let cookie = random();
        let mut registry = self.registry.lock().expect("registry mutex");
        registry.browsers.retain(|_, c| c.expires > Instant::now());
        if registry.browsers.len() >= 8192 {
            return Err(PreviewError::Limited);
        }
        registry.browsers.insert(
            digest(&cookie),
            Credential {
                preview: id.clone(),
                user: Some(user),
                expires: lease.expires,
            },
        );
        Ok(cookie)
    }
    /// Authenticate every HTTP request. WebSockets call this periodically too.
    pub async fn viewer(
        &self,
        id: &PreviewId,
        cookie: &str,
        activity: bool,
    ) -> Result<Arc<Lease>, PreviewError> {
        let (lease, user) = {
            let registry = self.registry.lock().expect("registry mutex");
            let credential = registry
                .browsers
                .get(&digest(cookie))
                .ok_or(PreviewError::Denied)?;
            if &credential.preview != id || credential.expires <= Instant::now() {
                return Err(PreviewError::Denied);
            }
            let user = credential.user.clone().ok_or(PreviewError::Denied)?;
            (find(&registry, id)?, user)
        };
        if !lease.live() {
            return Err(PreviewError::Offline);
        }
        let _authorization_slot = if activity {
            Some(
                lease
                    .requests
                    .clone()
                    .try_acquire_owned()
                    .map_err(|_| PreviewError::Limited)?,
            )
        } else {
            None
        };
        self.authority
            .viewer(lease.preview().agent_session_id, &user)
            .await?;
        if activity {
            *lease.activity.lock().expect("activity mutex") = Instant::now();
        }
        Ok(lease)
    }
    fn by_id(&self, id: &PreviewId) -> Result<Arc<Lease>, PreviewError> {
        let lease = find(&self.registry.lock().expect("registry mutex"), id)?;
        if !lease.live() {
            return Err(PreviewError::Offline);
        }
        Ok(lease)
    }
    /// Expire leases, including agent-session revocation, and reclaim bounded state.
    pub async fn sweep(&self) {
        let leases: Vec<_> = self
            .registry
            .lock()
            .expect("registry mutex")
            .sessions
            .values()
            .cloned()
            .collect();
        for lease in leases {
            if !lease.cancel.is_cancelled()
                && (!lease.live()
                    || self
                        .authority
                        .active(lease.preview().agent_session_id)
                        .await
                        .is_err())
            {
                self.finish(&lease, PreviewStatus::Expired).await;
            }
        }
        let mut registry = self.registry.lock().expect("registry mutex");
        registry
            .ssh_tokens
            .retain(|_, c| c.expires > Instant::now());
        registry.tickets.retain(|_, c| c.expires > Instant::now());
        registry.browsers.retain(|_, c| c.expires > Instant::now());
        registry
            .sessions
            .retain(|_, l| Instant::now() < l.expires + Duration::from_secs(300));
        registry
            .accounts
            .retain(|_, a| a.last_created.elapsed() < LEASE + LEASE);
        registry.watchers.retain(|_, users| {
            users.retain(|_, time| time.elapsed() < Duration::from_secs(300));
            !users.is_empty()
        });
    }
    async fn publish(&self, preview: &Preview) {
        let candidates = {
            let registry = self.registry.lock().expect("registry mutex");
            let mut users: Vec<MacroUserIdStr<'static>> = registry
                .watchers
                .get(&preview.agent_session_id)
                .map(|w| w.keys().cloned().collect())
                .unwrap_or_default();
            if let Some(lease) = registry.sessions.get(&preview.agent_session_id) {
                users.push(lease.owner.clone());
            }
            users.sort_by(|a, b| a.as_ref().cmp(b.as_ref()));
            users.dedup();
            users
        };
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
        let _ = self
            .events
            .changed(preview, &viewers)
            .await
            .inspect_err(|error| tracing::warn!(error = ?error, "preview notification failed"));
    }
}
/// The agent session a receipt authorizes, rejecting receipts for anything else.
fn session_id<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<AgentSessionId, PreviewError> {
    let entity = receipt.entity();
    if entity.entity_type != EntityType::AgentSession {
        return Err(PreviewError::Denied);
    }
    entity.entity_id.parse().map_err(|_| PreviewError::Denied)
}
fn find(registry: &Registry, id: &PreviewId) -> Result<Arc<Lease>, PreviewError> {
    registry
        .sessions
        .values()
        .find(|l| &l.preview().id == id)
        .cloned()
        .ok_or(PreviewError::Offline)
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
