//! Redis-backed storage for short-lived OAuth handshake state.

#[cfg(test)]
mod test;

use anyhow::Context;
use redis::AsyncCommands;
use std::future::Future;

use crate::domain::{
    models::{
        AuthorizationSession, ClientCallback, IdentityProvider, IssuedAuthorizationCode,
        LoginPhase, SessionId,
    },
    ports::InflightAuthStore,
    service::{AUTHORIZATION_CODE_TTL, AUTHORIZATION_SESSION_TTL},
};

const SESSION_KEY_PREFIX: &str = "mcp_auth_proxy:pending:";
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

    fn session_key(session_id: &SessionId) -> String {
        format!("{SESSION_KEY_PREFIX}{session_id}")
    }

    fn issued_key(code: &str) -> String {
        format!("{ISSUED_KEY_PREFIX}{code}")
    }
    fn set_session(
        &self,
        session: &AuthorizationSession,
    ) -> impl Future<Output = anyhow::Result<()>> + Send {
        let client = self.client.clone();
        let key = Self::session_key(&session.id);
        let value = serialize_session(session);
        async move {
            let value = value?;
            let mut conn = client
                .get_multiplexed_async_connection()
                .await
                .context("unable to connect to redis")?;
            conn.set_ex::<String, String, ()>(
                key.clone(),
                value,
                AUTHORIZATION_SESSION_TTL.as_secs(),
            )
            .await
            .with_context(|| format!("failed to persist authorization session for key {key}"))?;
            Ok(())
        }
    }
}

#[derive(serde::Deserialize)]
struct LegacyPendingAuthorization {
    code_challenge: String,
    client_state: String,
    client_redirect_uri: String,
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum StoredAuthorizationSession {
    Current(AuthorizationSession),
    Legacy(LegacyPendingAuthorization),
}

fn serialize_session(session: &AuthorizationSession) -> anyhow::Result<String> {
    serde_json::to_string(session).context("failed to serialize authorization session")
}

fn deserialize_session(session_id: &SessionId, json: &str) -> anyhow::Result<AuthorizationSession> {
    match serde_json::from_str::<StoredAuthorizationSession>(json)
        .context("failed to deserialize authorization session")?
    {
        StoredAuthorizationSession::Current(session) => Ok(session),
        StoredAuthorizationSession::Legacy(legacy) => Ok(AuthorizationSession {
            id: session_id.clone(),
            client: ClientCallback {
                code_challenge: legacy.code_challenge,
                client_state: legacy.client_state,
                client_redirect_uri: legacy.client_redirect_uri,
            },
            phase: LoginPhase::AwaitingUpstream {
                identity_provider: IdentityProvider::GoogleGmail,
            },
        }),
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

#[expect(
    clippy::manual_async_fn,
    reason = "the port requires methods that return opaque futures"
)]
impl InflightAuthStore for RedisInflightAuth {
    fn insert_session(
        &self,
        session: &AuthorizationSession,
    ) -> impl Future<Output = anyhow::Result<()>> + Send {
        self.set_session(session)
    }

    fn load_session(
        &self,
        session_id: &SessionId,
    ) -> impl Future<Output = anyhow::Result<Option<AuthorizationSession>>> + Send {
        let client = self.client.clone();
        let key = Self::session_key(session_id);
        let session_id = session_id.clone();
        async move {
            let mut conn = client
                .get_multiplexed_async_connection()
                .await
                .context("unable to connect to redis")?;
            let value: Option<String> = conn
                .get(&key)
                .await
                .with_context(|| format!("failed to load authorization session for key {key}"))?;
            value
                .map(|json| deserialize_session(&session_id, &json))
                .transpose()
        }
    }

    fn replace_session(
        &self,
        session: &AuthorizationSession,
    ) -> impl Future<Output = anyhow::Result<()>> + Send {
        self.set_session(session)
    }

    fn take_session(
        &self,
        session_id: &SessionId,
    ) -> impl Future<Output = anyhow::Result<Option<AuthorizationSession>>> + Send {
        let client = self.client.clone();
        let key = Self::session_key(session_id);
        let session_id = session_id.clone();
        async move {
            let mut conn = client
                .get_multiplexed_async_connection()
                .await
                .context("unable to connect to redis")?;
            let value: Option<String> = redis::cmd("GETDEL")
                .arg(&key)
                .query_async(&mut conn)
                .await
                .with_context(|| format!("failed to take authorization session for key {key}"))?;
            value
                .map(|json| deserialize_session(&session_id, &json))
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
            // Redis expires sessions and issued codes via SETEX. There is no
            // in-process map to sweep.
            Ok(())
        }
    }
}
