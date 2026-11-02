//! Redis-backed storage for short-lived OAuth handshake state.

#[cfg(test)]
mod test;

use anyhow::Context;
use redis::AsyncCommands;
use std::{
    future::Future,
    time::{Duration, UNIX_EPOCH},
};

use crate::domain::{
    models::{
        IssuedAuthorizationCode, PendingAuthorization, RefreshTokenBinding, RegisteredClient,
    },
    ports::{
        ClientRegistrationStore, GrantRevokedFuture, RefreshTokenBindingFuture,
        RefreshTokenBindingStore, RegisteredClientFuture, StoreWriteFuture,
    },
    service::{
        AUTHORIZATION_CODE_TTL, CLIENT_REGISTRATION_TTL, InflightAuthStore, PENDING_AUTH_TTL,
        REFRESH_TOKEN_BINDING_TTL, REVOKED_GRANT_TTL,
    },
};

const PENDING_KEY_PREFIX: &str = "mcp_auth_proxy:pending:";
const ISSUED_KEY_PREFIX: &str = "mcp_auth_proxy:issued:";
const CLIENT_KEY_PREFIX: &str = "mcp_auth_proxy:client:";
const REFRESH_BINDING_KEY_PREFIX: &str = "mcp_auth_proxy:refresh_binding:";
const REVOKED_GRANT_KEY_PREFIX: &str = "mcp_auth_proxy:revoked_grant:";

/// Redis-backed implementation of the in-flight OAuth state store.
#[derive(Clone)]
pub struct RedisInflightAuth {
    client: redis::Client,
}

impl RedisInflightAuth {
    /// Creates a new Redis-backed in-flight OAuth state store.
    pub fn new(client: redis::Client) -> Self {
        Self { client }
    }

    fn pending_key(session_id: &str) -> String {
        format!("{PENDING_KEY_PREFIX}{session_id}")
    }

    fn issued_key(code: &str) -> String {
        format!("{ISSUED_KEY_PREFIX}{code}")
    }
}

/// Redis-backed store for dynamic client registrations and the refresh token
/// bindings derived from them.
#[derive(Clone)]
pub struct RedisClientRegistry {
    client: redis::Client,
}

impl RedisClientRegistry {
    /// Creates a new Redis-backed client registry.
    pub fn new(client: redis::Client) -> Self {
        Self { client }
    }

    fn client_key(client_id: &str) -> String {
        format!("{CLIENT_KEY_PREFIX}{client_id}")
    }

    fn refresh_binding_key(refresh_token_digest: &str) -> String {
        format!("{REFRESH_BINDING_KEY_PREFIX}{refresh_token_digest}")
    }

    fn revoked_grant_key(grant_id: &str) -> String {
        format!("{REVOKED_GRANT_KEY_PREFIX}{grant_id}")
    }

    /// Every live registration, with the time it has left.
    pub async fn export_clients(&self) -> anyhow::Result<Vec<(RegisteredClient, Duration)>> {
        let entries = self.export(CLIENT_KEY_PREFIX).await?;
        entries
            .into_iter()
            .map(|(_, json, remaining)| {
                let client = serde_json::from_str::<StoredRegisteredClient>(&json)
                    .map(RegisteredClient::from)
                    .context("failed to deserialize client registration")?;
                Ok((client, remaining))
            })
            .collect()
    }

    /// Every live refresh token binding as `(digest, binding, time left)`.
    pub async fn export_bindings(
        &self,
    ) -> anyhow::Result<Vec<(String, RefreshTokenBinding, Duration)>> {
        let entries = self.export(REFRESH_BINDING_KEY_PREFIX).await?;
        entries
            .into_iter()
            .map(|(digest, value, remaining)| {
                let binding = parse_refresh_token_binding(&digest, value)?;
                Ok((digest, binding, remaining))
            })
            .collect()
    }

    /// Every live grant revocation as `(grant_id, time left)`.
    pub async fn export_revoked_grants(&self) -> anyhow::Result<Vec<(String, Duration)>> {
        let entries = self.export(REVOKED_GRANT_KEY_PREFIX).await?;
        Ok(entries
            .into_iter()
            .map(|(grant_id, _, remaining)| (grant_id, remaining))
            .collect())
    }

    /// Reads every key under `prefix` as `(suffix, value, time left)`. Keys
    /// that expire mid-scan, or carry no TTL, are skipped.
    async fn export(&self, prefix: &str) -> anyhow::Result<Vec<(String, String, Duration)>> {
        let mut conn = self
            .client
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;
        let mut keys: Vec<String> = Vec::new();
        let mut cursor: u64 = 0;
        loop {
            let (next, batch): (u64, Vec<String>) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg(format!("{prefix}*"))
                .arg("COUNT")
                .arg(EXPORT_SCAN_COUNT)
                .query_async(&mut conn)
                .await
                .with_context(|| format!("failed to scan keys under {prefix}"))?;
            keys.extend(batch);
            if next == 0 {
                break;
            }
            cursor = next;
        }
        // SCAN may return a key more than once.
        keys.sort_unstable();
        keys.dedup();

        let mut entries = Vec::with_capacity(keys.len());
        for chunk in keys.chunks(EXPORT_READ_BATCH) {
            let mut pipeline = redis::pipe();
            for key in chunk {
                pipeline.get(key).pttl(key);
            }
            let values: Vec<(Option<String>, i64)> = pipeline
                .query_async(&mut conn)
                .await
                .with_context(|| format!("failed to read keys under {prefix}"))?;
            for (key, (value, remaining_ms)) in chunk.iter().zip(values) {
                let (Some(value), Ok(remaining_ms)) = (value, u64::try_from(remaining_ms)) else {
                    continue;
                };
                if let Some(suffix) = key.strip_prefix(prefix) {
                    entries.push((
                        suffix.to_owned(),
                        value,
                        Duration::from_millis(remaining_ms),
                    ));
                }
            }
        }
        Ok(entries)
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct StoredRefreshTokenBinding {
    client_id: String,
    grant_id: String,
}

/// Reads a stored binding. Bindings written before grants were tracked hold
/// the bare client id; each becomes a family of its own, named by its digest,
/// and keeps that grant id as it rotates.
fn parse_refresh_token_binding(
    refresh_token_digest: &str,
    value: String,
) -> anyhow::Result<RefreshTokenBinding> {
    if !value.starts_with('{') {
        return Ok(RefreshTokenBinding {
            client_id: value,
            grant_id: refresh_token_digest.to_owned(),
        });
    }
    let stored: StoredRefreshTokenBinding =
        serde_json::from_str(&value).context("failed to deserialize refresh token binding")?;
    Ok(RefreshTokenBinding {
        client_id: stored.client_id,
        grant_id: stored.grant_id,
    })
}

/// Keys SCAN examines per call while exporting. The cache holds millions of
/// unrelated keys, so a larger page means far fewer round trips.
const EXPORT_SCAN_COUNT: usize = 10_000;
/// Keys read per pipelined round trip while exporting.
const EXPORT_READ_BATCH: usize = 500;

#[derive(serde::Serialize, serde::Deserialize)]
struct StoredRegisteredClient {
    client_id: String,
    client_name: String,
    redirect_uris: Vec<String>,
}

impl From<&RegisteredClient> for StoredRegisteredClient {
    fn from(value: &RegisteredClient) -> Self {
        Self {
            client_id: value.client_id.clone(),
            client_name: value.client_name.clone(),
            redirect_uris: value.redirect_uris.clone(),
        }
    }
}

impl From<StoredRegisteredClient> for RegisteredClient {
    fn from(value: StoredRegisteredClient) -> Self {
        Self {
            client_id: value.client_id,
            client_name: value.client_name,
            redirect_uris: value.redirect_uris,
        }
    }
}

#[allow(clippy::manual_async_fn)]
impl ClientRegistrationStore for RedisClientRegistry {
    fn insert_client<'a>(&'a self, client: &'a RegisteredClient) -> StoreWriteFuture<'a> {
        let redis_client = self.client.clone();
        let key = Self::client_key(&client.client_id);
        Box::pin(async move {
            let value = serde_json::to_string(&StoredRegisteredClient::from(client))
                .context("failed to serialize client registration")?;
            let mut conn = redis_client
                .get_multiplexed_async_connection()
                .await
                .context("unable to connect to redis")?;
            conn.set_ex::<String, String, ()>(
                key.clone(),
                value,
                CLIENT_REGISTRATION_TTL.as_secs(),
            )
            .await
            .with_context(|| format!("failed to persist client registration for key {key}"))?;
            Ok(())
        })
    }

    fn find_client<'a>(&'a self, client_id: &'a str) -> RegisteredClientFuture<'a> {
        let redis_client = self.client.clone();
        let key = Self::client_key(client_id);
        Box::pin(async move {
            let mut conn = redis_client
                .get_multiplexed_async_connection()
                .await
                .context("unable to connect to redis")?;
            // GETEX reads and re-arms the TTL in one round trip, which makes a
            // registration expire only after it has gone unused for the whole
            // window rather than a fixed time after it was created.
            let value: Option<String> = redis::cmd("GETEX")
                .arg(&key)
                .arg("EX")
                .arg(CLIENT_REGISTRATION_TTL.as_secs())
                .query_async(&mut conn)
                .await
                .with_context(|| format!("failed to fetch client registration for key {key}"))?;
            value
                .map(|json| {
                    serde_json::from_str::<StoredRegisteredClient>(&json)
                        .map(RegisteredClient::from)
                        .context("failed to deserialize client registration")
                })
                .transpose()
        })
    }
}

#[allow(clippy::manual_async_fn)]
impl RefreshTokenBindingStore for RedisClientRegistry {
    fn bind<'a>(
        &'a self,
        refresh_token_digest: &'a str,
        binding: &'a RefreshTokenBinding,
    ) -> StoreWriteFuture<'a> {
        let redis_client = self.client.clone();
        let key = Self::refresh_binding_key(refresh_token_digest);
        Box::pin(async move {
            let value = serde_json::to_string(&StoredRefreshTokenBinding {
                client_id: binding.client_id.clone(),
                grant_id: binding.grant_id.clone(),
            })
            .context("failed to serialize refresh token binding")?;
            let mut conn = redis_client
                .get_multiplexed_async_connection()
                .await
                .context("unable to connect to redis")?;
            conn.set_ex::<String, String, ()>(
                key.clone(),
                value,
                REFRESH_TOKEN_BINDING_TTL.as_secs(),
            )
            .await
            .with_context(|| format!("failed to persist refresh token binding for key {key}"))?;
            Ok(())
        })
    }

    fn binding<'a>(&'a self, refresh_token_digest: &'a str) -> RefreshTokenBindingFuture<'a> {
        let redis_client = self.client.clone();
        let key = Self::refresh_binding_key(refresh_token_digest);
        Box::pin(async move {
            let mut conn = redis_client
                .get_multiplexed_async_connection()
                .await
                .context("unable to connect to redis")?;
            let value: Option<String> = conn
                .get(&key)
                .await
                .with_context(|| format!("failed to fetch refresh token binding for key {key}"))?;
            value
                .map(|value| parse_refresh_token_binding(refresh_token_digest, value))
                .transpose()
        })
    }

    fn unbind<'a>(&'a self, refresh_token_digest: &'a str) -> StoreWriteFuture<'a> {
        let redis_client = self.client.clone();
        let key = Self::refresh_binding_key(refresh_token_digest);
        Box::pin(async move {
            let mut conn = redis_client
                .get_multiplexed_async_connection()
                .await
                .context("unable to connect to redis")?;
            conn.del::<&str, ()>(&key)
                .await
                .with_context(|| format!("failed to delete refresh token binding for key {key}"))?;
            Ok(())
        })
    }

    fn revoke_grant<'a>(&'a self, grant_id: &'a str) -> StoreWriteFuture<'a> {
        let redis_client = self.client.clone();
        let key = Self::revoked_grant_key(grant_id);
        Box::pin(async move {
            let mut conn = redis_client
                .get_multiplexed_async_connection()
                .await
                .context("unable to connect to redis")?;
            conn.set_ex::<String, u8, ()>(key.clone(), 1, REVOKED_GRANT_TTL.as_secs())
                .await
                .with_context(|| format!("failed to persist grant revocation for key {key}"))?;
            Ok(())
        })
    }

    fn is_grant_revoked<'a>(&'a self, grant_id: &'a str) -> GrantRevokedFuture<'a> {
        let redis_client = self.client.clone();
        let key = Self::revoked_grant_key(grant_id);
        Box::pin(async move {
            let mut conn = redis_client
                .get_multiplexed_async_connection()
                .await
                .context("unable to connect to redis")?;
            let revoked: bool = conn
                .exists(&key)
                .await
                .with_context(|| format!("failed to read grant revocation for key {key}"))?;
            Ok(revoked)
        })
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct StoredPendingAuthorization {
    client_id: String,
    code_challenge: String,
    client_state: String,
    client_redirect_uri: String,
}

impl From<PendingAuthorization> for StoredPendingAuthorization {
    fn from(value: PendingAuthorization) -> Self {
        Self {
            client_id: value.client_id,
            code_challenge: value.code_challenge,
            client_state: value.client_state,
            client_redirect_uri: value.client_redirect_uri,
        }
    }
}

impl From<StoredPendingAuthorization> for PendingAuthorization {
    fn from(value: StoredPendingAuthorization) -> Self {
        Self {
            client_id: value.client_id,
            code_challenge: value.code_challenge,
            client_state: value.client_state,
            client_redirect_uri: value.client_redirect_uri,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct StoredIssuedAuthorizationCode {
    client_id: String,
    access_token: crate::domain::models::AccessToken,
    refresh_token: crate::domain::models::RefreshToken,
    code_challenge: String,
    redirect_uri: String,
    /// Unix seconds at which the upstream access token expires.
    access_token_expires_at_unix: u64,
}

impl From<IssuedAuthorizationCode> for StoredIssuedAuthorizationCode {
    fn from(value: IssuedAuthorizationCode) -> Self {
        Self {
            client_id: value.client_id,
            access_token: value.access_token,
            refresh_token: value.refresh_token,
            code_challenge: value.code_challenge,
            redirect_uri: value.redirect_uri,
            access_token_expires_at_unix: value
                .access_token_expires_at
                .duration_since(UNIX_EPOCH)
                .map(|since_epoch| since_epoch.as_secs())
                .unwrap_or(0),
        }
    }
}

impl From<StoredIssuedAuthorizationCode> for IssuedAuthorizationCode {
    fn from(value: StoredIssuedAuthorizationCode) -> Self {
        Self {
            client_id: value.client_id,
            access_token: value.access_token,
            refresh_token: value.refresh_token,
            code_challenge: value.code_challenge,
            redirect_uri: value.redirect_uri,
            access_token_expires_at: UNIX_EPOCH
                + Duration::from_secs(value.access_token_expires_at_unix),
        }
    }
}

#[allow(clippy::manual_async_fn)]
impl InflightAuthStore for RedisInflightAuth {
    fn insert_pending(
        &self,
        session_id: &str,
        pending: PendingAuthorization,
    ) -> impl Future<Output = anyhow::Result<()>> + Send {
        let client = self.client.clone();
        let key = Self::pending_key(session_id);
        async move {
            let value = serde_json::to_string(&StoredPendingAuthorization::from(pending))
                .context("failed to serialize pending authorization")?;
            let mut conn = client
                .get_multiplexed_async_connection()
                .await
                .context("unable to connect to redis")?;
            conn.set_ex::<String, String, ()>(key.clone(), value, PENDING_AUTH_TTL.as_secs())
                .await
                .with_context(|| {
                    format!("failed to persist pending authorization for key {key}")
                })?;
            Ok(())
        }
    }

    fn take_pending(
        &self,
        session_id: &str,
    ) -> impl Future<Output = anyhow::Result<Option<PendingAuthorization>>> + Send {
        let client = self.client.clone();
        let key = Self::pending_key(session_id);
        async move {
            let mut conn = client
                .get_multiplexed_async_connection()
                .await
                .context("unable to connect to redis")?;
            let value: Option<String> = redis::cmd("GETDEL")
                .arg(&key)
                .query_async(&mut conn)
                .await
                .with_context(|| format!("failed to fetch pending authorization for key {key}"))?;
            value
                .map(|json| {
                    serde_json::from_str::<StoredPendingAuthorization>(&json)
                        .map(PendingAuthorization::from)
                        .context("failed to deserialize pending authorization")
                })
                .transpose()
        }
    }

    fn insert_issued(
        &self,
        code: &str,
        issued: IssuedAuthorizationCode,
    ) -> impl Future<Output = anyhow::Result<()>> + Send {
        let client = self.client.clone();
        let key = Self::issued_key(code);
        async move {
            let value = serde_json::to_string(&StoredIssuedAuthorizationCode::from(issued))
                .context("failed to serialize issued authorization code")?;
            let mut conn = client
                .get_multiplexed_async_connection()
                .await
                .context("unable to connect to redis")?;
            conn.set_ex::<String, String, ()>(key.clone(), value, AUTHORIZATION_CODE_TTL.as_secs())
                .await
                .with_context(|| {
                    format!("failed to persist issued authorization code for key {key}")
                })?;
            Ok(())
        }
    }

    fn take_issued(
        &self,
        code: &str,
    ) -> impl Future<Output = anyhow::Result<Option<IssuedAuthorizationCode>>> + Send {
        let client = self.client.clone();
        let key = Self::issued_key(code);
        async move {
            let mut conn = client
                .get_multiplexed_async_connection()
                .await
                .context("unable to connect to redis")?;
            let value: Option<String> = redis::cmd("GETDEL")
                .arg(&key)
                .query_async(&mut conn)
                .await
                .with_context(|| {
                    format!("failed to fetch issued authorization code for key {key}")
                })?;
            value
                .map(|json| {
                    serde_json::from_str::<StoredIssuedAuthorizationCode>(&json)
                        .map(IssuedAuthorizationCode::from)
                        .context("failed to deserialize issued authorization code")
                })
                .transpose()
        }
    }

    fn cleanup_expired(&self) -> impl Future<Output = anyhow::Result<()>> + Send {
        async {
            // Redis enforces expiry via the TTL set with `SETEX` on every pending
            // session and issued code. There is no separate in-process map to
            // sweep, so cleanup is intentionally a no-op for this backend.
            Ok(())
        }
    }
}
