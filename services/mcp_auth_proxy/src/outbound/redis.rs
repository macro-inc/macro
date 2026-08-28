//! Redis-backed storage for short-lived OAuth handshake state.

use anyhow::Context;
use redis::AsyncCommands;
use std::{
    future::Future,
    time::{Duration, UNIX_EPOCH},
};

use crate::domain::{
    models::{IssuedAuthorizationCode, PendingAuthorization, RegisteredClient},
    ports::{
        BoundClientIdFuture, ClientRegistrationStore, RefreshTokenBindingStore,
        RegisteredClientFuture, StoreWriteFuture,
    },
    service::{
        AUTHORIZATION_CODE_TTL, CLIENT_REGISTRATION_TTL, InflightAuthStore, PENDING_AUTH_TTL,
        REFRESH_TOKEN_BINDING_TTL,
    },
};

const PENDING_KEY_PREFIX: &str = "mcp_auth_proxy:pending:";
const ISSUED_KEY_PREFIX: &str = "mcp_auth_proxy:issued:";
const CLIENT_KEY_PREFIX: &str = "mcp_auth_proxy:client:";
const REFRESH_BINDING_KEY_PREFIX: &str = "mcp_auth_proxy:refresh_binding:";

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
}

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
        client_id: &'a str,
    ) -> StoreWriteFuture<'a> {
        let redis_client = self.client.clone();
        let key = Self::refresh_binding_key(refresh_token_digest);
        Box::pin(async move {
            let mut conn = redis_client
                .get_multiplexed_async_connection()
                .await
                .context("unable to connect to redis")?;
            conn.set_ex::<String, &str, ()>(
                key.clone(),
                client_id,
                REFRESH_TOKEN_BINDING_TTL.as_secs(),
            )
            .await
            .with_context(|| format!("failed to persist refresh token binding for key {key}"))?;
            Ok(())
        })
    }

    fn bound_client<'a>(&'a self, refresh_token_digest: &'a str) -> BoundClientIdFuture<'a> {
        let redis_client = self.client.clone();
        let key = Self::refresh_binding_key(refresh_token_digest);
        Box::pin(async move {
            let mut conn = redis_client
                .get_multiplexed_async_connection()
                .await
                .context("unable to connect to redis")?;
            let client_id: Option<String> = conn
                .get(&key)
                .await
                .with_context(|| format!("failed to fetch refresh token binding for key {key}"))?;
            Ok(client_id)
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
    /// Unix seconds at which the upstream access token expires. Defaults to
    /// `None` so codes written before this field existed still deserialize.
    #[serde(default)]
    access_token_expires_at_unix: Option<u64>,
}

impl From<IssuedAuthorizationCode> for StoredIssuedAuthorizationCode {
    fn from(value: IssuedAuthorizationCode) -> Self {
        Self {
            client_id: value.client_id,
            access_token: value.access_token,
            refresh_token: value.refresh_token,
            code_challenge: value.code_challenge,
            redirect_uri: value.redirect_uri,
            access_token_expires_at_unix: value.access_token_expires_at.and_then(|expires_at| {
                expires_at
                    .duration_since(UNIX_EPOCH)
                    .ok()
                    .map(|since_epoch| since_epoch.as_secs())
            }),
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
            access_token_expires_at: value
                .access_token_expires_at_unix
                .map(|unix_seconds| UNIX_EPOCH + Duration::from_secs(unix_seconds)),
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
