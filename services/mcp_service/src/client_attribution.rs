//! Remembers which MCP client a bearer token belongs to, so every tool call
//! can be attributed to a client.
//!
//! The server is stateless: a client reports its name and version once, in
//! `initialize`, and later `tools/call` requests carry nothing but the token.
//! So the handshake (and the sign-in, which knows the registered name) records
//! `token digest -> client`, and tool calls look it up. A refreshed token has
//! no entry until the client next initializes, so the person's last client is
//! kept as a fallback. Redis makes this hold across instances; a small
//! in-process cache keeps the lookup off the hot path.

#[cfg(test)]
mod test;

use std::{num::NonZeroUsize, sync::Arc, time::Duration};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use redis::AsyncCommands;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

use crate::telemetry::ClientInfo;

/// How long a token's client is remembered: longer than any access token
/// lives, so a token never outlives its attribution.
const TOKEN_CLIENT_TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// How long a person's last client is remembered.
const USER_CLIENT_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);
/// Entries kept in process.
const LOCAL_CACHE_ENTRIES: usize = 4096;
const TOKEN_KEY_PREFIX: &str = "mcp:client:token:";
const USER_KEY_PREFIX: &str = "mcp:client:user:";

/// Where attribution is stored beyond this process.
pub trait ClientStore: Send + Sync + 'static {
    /// Stores `client` under `key` for `ttl`.
    fn put(
        &self,
        key: String,
        client: &ClientInfo,
        ttl: Duration,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Reads the client stored under `key`.
    fn get(&self, key: String) -> impl Future<Output = anyhow::Result<Option<ClientInfo>>> + Send;
}

/// [`ClientStore`] on the MCP server's Redis.
#[derive(Clone)]
pub struct RedisClientStore {
    client: redis::Client,
}

impl RedisClientStore {
    /// A store on the given Redis.
    pub fn new(client: redis::Client) -> Self {
        Self { client }
    }
}

impl ClientStore for RedisClientStore {
    async fn put(&self, key: String, client: &ClientInfo, ttl: Duration) -> anyhow::Result<()> {
        let value = serde_json::to_string(client)?;
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        conn.set_ex::<_, _, ()>(key, value, ttl.as_secs()).await?;
        Ok(())
    }

    async fn get(&self, key: String) -> anyhow::Result<Option<ClientInfo>> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let value: Option<String> = conn.get(key).await?;
        value
            .map(|json| serde_json::from_str(&json).map_err(anyhow::Error::from))
            .transpose()
    }
}

/// Token and person to client attribution.
pub struct ClientAttribution<S> {
    store: S,
    local: Arc<Mutex<lru::LruCache<String, ClientInfo>>>,
}

impl<S: Clone> Clone for ClientAttribution<S> {
    fn clone(&self) -> Self {
        Self {
            store: self.store.clone(),
            local: Arc::clone(&self.local),
        }
    }
}

/// Digest of a bearer token, so neither Redis nor memory holds a usable
/// credential.
fn token_key(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    format!("{TOKEN_KEY_PREFIX}{}", URL_SAFE_NO_PAD.encode(digest))
}

fn user_key(user_id: &str) -> String {
    format!("{USER_KEY_PREFIX}{user_id}")
}

impl<S: ClientStore> ClientAttribution<S> {
    /// Attribution backed by `store`.
    pub fn new(store: S) -> Self {
        Self {
            store,
            local: Arc::new(Mutex::new(lru::LruCache::new(
                NonZeroUsize::new(LOCAL_CACHE_ENTRIES).expect("cache size is non-zero"),
            ))),
        }
    }

    /// Records the client a person reported for this token. Best-effort:
    /// attribution must never fail a request.
    pub async fn remember(&self, token: &str, user_id: &str, client: &ClientInfo) {
        let token_key = token_key(token);
        let user_key = user_key(user_id);
        {
            let mut local = self.local.lock().await;
            local.put(token_key.clone(), client.clone());
            local.put(user_key.clone(), client.clone());
        }
        for (key, ttl) in [(token_key, TOKEN_CLIENT_TTL), (user_key, USER_CLIENT_TTL)] {
            if let Err(error) = self.store.put(key, client, ttl).await {
                tracing::warn!(error=?error, "failed to store MCP client attribution");
            }
        }
    }

    /// Records the registered client name from sign-in, unless the token is
    /// already attributed (the handshake's self-reported name wins).
    pub async fn remember_if_unknown(&self, token: &str, user_id: &str, client: &ClientInfo) {
        if self.lookup_key(token_key(token)).await.is_none() {
            self.remember(token, user_id, client).await;
        }
    }

    /// The client behind this token: the one it initialized with, else the
    /// person's last client, else nothing.
    pub async fn client_for(&self, token: &str, user_id: &str) -> Option<ClientInfo> {
        match self.lookup_key(token_key(token)).await {
            Some(client) => Some(client),
            None => self.lookup_key(user_key(user_id)).await,
        }
    }

    async fn lookup_key(&self, key: String) -> Option<ClientInfo> {
        if let Some(client) = self.local.lock().await.get(&key).cloned() {
            return Some(client);
        }
        let found = self
            .store
            .get(key.clone())
            .await
            .inspect_err(
                |error| tracing::warn!(error=?error, "failed to read MCP client attribution"),
            )
            .ok()
            .flatten()?;
        self.local.lock().await.put(key, found.clone());
        Some(found)
    }
}
