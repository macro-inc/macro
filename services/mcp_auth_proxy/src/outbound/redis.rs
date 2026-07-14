//! Redis-backed storage for short-lived OAuth handshake state.

use anyhow::Context;
use redis::AsyncCommands;
use std::future::Future;

use crate::domain::{
    models::{IssuedAuthorizationCode, PendingAuthorization},
    service::{AUTHORIZATION_CODE_TTL, InflightAuthStore, PENDING_AUTH_TTL},
};

const PENDING_KEY_PREFIX: &str = "mcp_auth_proxy:pending:";
const ISSUED_KEY_PREFIX: &str = "mcp_auth_proxy:issued:";

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

#[derive(serde::Serialize, serde::Deserialize)]
struct StoredPendingAuthorization {
    code_challenge: String,
    client_state: String,
    client_redirect_uri: String,
}

impl From<PendingAuthorization> for StoredPendingAuthorization {
    fn from(value: PendingAuthorization) -> Self {
        Self {
            code_challenge: value.code_challenge,
            client_state: value.client_state,
            client_redirect_uri: value.client_redirect_uri,
        }
    }
}

impl From<StoredPendingAuthorization> for PendingAuthorization {
    fn from(value: StoredPendingAuthorization) -> Self {
        Self {
            code_challenge: value.code_challenge,
            client_state: value.client_state,
            client_redirect_uri: value.client_redirect_uri,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct StoredIssuedAuthorizationCode {
    access_token: crate::domain::models::AccessToken,
    refresh_token: crate::domain::models::RefreshToken,
    code_challenge: String,
    redirect_uri: String,
}

impl From<IssuedAuthorizationCode> for StoredIssuedAuthorizationCode {
    fn from(value: IssuedAuthorizationCode) -> Self {
        Self {
            access_token: value.access_token,
            refresh_token: value.refresh_token,
            code_challenge: value.code_challenge,
            redirect_uri: value.redirect_uri,
        }
    }
}

impl From<StoredIssuedAuthorizationCode> for IssuedAuthorizationCode {
    fn from(value: StoredIssuedAuthorizationCode) -> Self {
        Self {
            access_token: value.access_token,
            refresh_token: value.refresh_token,
            code_challenge: value.code_challenge,
            redirect_uri: value.redirect_uri,
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
