//! One-time, owner-bound browser consent. No provider tokens cross the inbound boundary.
use super::model::{Credentials, Error, Secret};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;
use tokio::sync::Mutex;

const LOGIN_TTL: Duration = Duration::from_secs(600);
const MAX_ATTEMPTS: usize = 1024;

/// Redacted, user-actionable connection errors.
#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    /// This deployment does not enable interactive demo connections.
    #[error("Claude connection is available only in the local demo")]
    Disabled,
    /// Attempt expired, was canceled, replayed, or belongs to another user.
    #[error("Sign-in expired or was replaced. Start Connect Claude again.")]
    InvalidAttempt,
    /// Manual callback input must contain Claude's code and matching state.
    #[error("Paste the complete one-time code from Claude, including the # suffix.")]
    InvalidCode,
    /// Global capacity or repeated starts are bounded.
    #[error("Please wait a moment before starting another sign-in.")]
    Busy,
    /// Provider or storage failures never include response bodies or secrets.
    #[error("Claude connection failed: {0}")]
    Provider(#[from] Error),
}

/// Browser-safe status; tokens and provider identifiers are never returned.
pub struct ConnectionStatus {
    /// Whether connecting is enabled in this deployment.
    pub enabled: bool,
    /// Whether the authenticated user has a grant.
    pub connected: bool,
    /// In-memory connections disappear when the service restarts.
    pub ephemeral: bool,
}

/// Browser-safe start response.
pub struct Login {
    /// Opaque attempt handle bound to the initiating Macro user.
    pub attempt_id: String,
    /// Fixed-provider consent URL containing only public PKCE information.
    pub authorization_url: String,
    /// Seconds until this attempt expires.
    pub expires_in: u64,
}

/// OAuth protocol capability; implemented outside the domain.
pub trait OAuthProvider: Send + Sync + 'static {
    /// Construct the fixed-origin consent URL.
    fn authorization_url(&self, state: &str, verifier: &Secret) -> String;
    /// Exchange a one-time code and resolve the grant's cloud environment.
    fn exchange(
        &self,
        code: Secret,
        state: &str,
        verifier: Secret,
    ) -> impl Future<Output = Result<Credentials, Error>> + Send;
}

/// Owner-keyed credential storage capability.
pub trait ConnectionStore: Send + Sync + 'static {
    /// Query presence without returning secrets.
    fn connected(&self, owner: &str) -> impl Future<Output = bool> + Send;
    /// Save a grant for exactly the authenticated owner.
    fn save(
        &self,
        owner: &str,
        credentials: Credentials,
    ) -> impl Future<Output = Result<(), Error>> + Send;
    /// Forget only this owner's grant. Does not revoke unrelated provider sessions.
    fn remove(&self, owner: &str) -> impl Future<Output = Result<(), Error>> + Send;
}

/// Use cases exposed to the HTTP adapter.
pub trait ClaudeAuth: Send + Sync + 'static {
    /// Return the current user's connection status.
    fn status(&self, owner: &str) -> impl Future<Output = ConnectionStatus> + Send;
    /// Start a new user-bound PKCE attempt, replacing older attempts.
    fn begin(&self, owner: &str) -> impl Future<Output = Result<Login, AuthError>> + Send;
    /// Consume a code once and save the resulting grant for its initiator.
    fn complete(
        &self,
        owner: &str,
        attempt_id: &str,
        code: Secret,
    ) -> impl Future<Output = Result<(), AuthError>> + Send;
    /// Cancel pending consent and forget this user's connection.
    fn disconnect(&self, owner: &str) -> impl Future<Output = Result<(), AuthError>> + Send;
}

struct Attempt {
    id: String,
    state: String,
    verifier: Option<Secret>,
    started: Instant,
}

/// Local-demo policy: bounded, expiring, one-use attempts, bound to authenticated users.
pub struct AuthService<P, S> {
    provider: P,
    store: Option<S>,
    ephemeral: bool,
    attempts: Arc<Mutex<HashMap<String, Attempt>>>,
}

impl<P, S> AuthService<P, S> {
    /// Enable via a store supplied by the composition root; None disables all writes.
    pub fn new(provider: P, store: Option<S>, ephemeral: bool) -> Self {
        Self {
            provider,
            store,
            ephemeral,
            attempts: Arc::default(),
        }
    }
}

fn random_secret() -> String {
    URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>())
}

impl<P: OAuthProvider, S: ConnectionStore> ClaudeAuth for AuthService<P, S> {
    async fn status(&self, owner: &str) -> ConnectionStatus {
        ConnectionStatus {
            enabled: self.store.is_some(),
            connected: match &self.store {
                Some(store) => store.connected(owner).await,
                None => false,
            },
            ephemeral: self.ephemeral,
        }
    }

    async fn begin(&self, owner: &str) -> Result<Login, AuthError> {
        self.store.as_ref().ok_or(AuthError::Disabled)?;
        let mut attempts = self.attempts.lock().await;
        attempts.retain(|_, attempt| attempt.started.elapsed() < LOGIN_TTL);
        if attempts
            .get(owner)
            .is_some_and(|a| a.started.elapsed() < Duration::from_secs(2))
            || (!attempts.contains_key(owner) && attempts.len() >= MAX_ATTEMPTS)
        {
            return Err(AuthError::Busy);
        }
        let state = random_secret();
        let verifier = Secret::parse(random_secret())?;
        let attempt_id = random_secret();
        let authorization_url = self.provider.authorization_url(&state, &verifier);
        attempts.insert(
            owner.to_owned(),
            Attempt {
                id: attempt_id.clone(),
                state,
                verifier: Some(verifier),
                started: Instant::now(),
            },
        );
        Ok(Login {
            attempt_id,
            authorization_url,
            expires_in: LOGIN_TTL.as_secs(),
        })
    }

    async fn complete(
        &self,
        owner: &str,
        attempt_id: &str,
        input: Secret,
    ) -> Result<(), AuthError> {
        let store = self.store.as_ref().ok_or(AuthError::Disabled)?;
        let raw = input.expose().trim();
        if raw.len() > 4096 {
            return Err(AuthError::InvalidCode);
        }
        let (code, state) = raw.split_once('#').ok_or(AuthError::InvalidCode)?;
        if code.is_empty()
            || !code
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.~".contains(&b))
        {
            return Err(AuthError::InvalidCode);
        }
        let verifier = {
            let mut attempts = self.attempts.lock().await;
            let attempt = attempts.get_mut(owner).ok_or(AuthError::InvalidAttempt)?;
            if attempt.id != attempt_id || attempt.started.elapsed() >= LOGIN_TTL {
                return Err(AuthError::InvalidAttempt);
            }
            if !bool::from(attempt.state.as_bytes().ct_eq(state.as_bytes())) {
                return Err(AuthError::InvalidCode);
            }
            // Taking the verifier consumes the attempt before making any network request.
            attempt.verifier.take().ok_or(AuthError::InvalidAttempt)?
        };
        let result = self
            .provider
            .exchange(Secret::parse(code.to_owned())?, state, verifier)
            .await;
        let mut attempts = self.attempts.lock().await;
        if !attempts
            .get(owner)
            .is_some_and(|a| a.id == attempt_id && a.started.elapsed() < LOGIN_TTL)
        {
            return Err(AuthError::InvalidAttempt);
        }
        attempts.remove(owner);
        // Serialize save against disconnect/restart of consent; late completion cannot reconnect.
        store.save(owner, result?).await?;
        Ok(())
    }

    async fn disconnect(&self, owner: &str) -> Result<(), AuthError> {
        let store = self.store.as_ref().ok_or(AuthError::Disabled)?;
        let mut attempts = self.attempts.lock().await;
        attempts.remove(owner);
        store.remove(owner).await?;
        Ok(())
    }
}

#[cfg(test)]
mod test;
