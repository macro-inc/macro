//! One-time, owner-bound browser consent. No provider tokens cross the inbound boundary.
use super::credentials::{ConnectionState, GrantTransaction};
use super::model::{Credentials, Error, Secret};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use subtle::ConstantTimeEq;

const LOGIN_TTL: Duration = Duration::from_secs(600);

/// Redacted, user-actionable connection errors.
#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    /// This deployment has no configured connection store.
    #[error("Claude connection is not configured on this deployment")]
    Disabled,
    /// Attempt expired, was canceled, replayed, or belongs to another user.
    #[error("Sign-in expired or was replaced. Start Connect Claude again.")]
    InvalidAttempt,
    /// Manual callback input must contain Claude's code and matching state.
    #[error("Paste the complete one-time code from Claude, including the # suffix.")]
    InvalidCode,
    /// Repeated starts are bounded per owner.
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
    /// Lock the owner's complete connection state across replicas.
    fn lock(
        &self,
        owner: &str,
    ) -> impl Future<Output = Result<Box<dyn GrantTransaction>, Error>> + Send;
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

/// Encrypted pending consent. No verifier is returned to the browser.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct Attempt {
    /// Opaque handle bound to the owner by storage.
    pub id: String,
    /// Expected OAuth state.
    pub state: String,
    /// Consumed durably before token exchange.
    pub verifier: Option<Secret>,
    /// Unix timestamp used across replicas and restarts.
    pub started: u64,
}

fn now() -> Result<u64, Error> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_secs())
        .map_err(|_| Error::Credentials)
}

/// Expiring, one-use browser consent bound to authenticated users.
pub struct AuthService<P, S> {
    provider: P,
    store: Option<S>,
    ephemeral: bool,
}

impl<P, S> AuthService<P, S> {
    /// Enable via a store supplied by the composition root; None disables all writes.
    pub fn new(provider: P, store: Option<S>, ephemeral: bool) -> Self {
        Self {
            provider,
            store,
            ephemeral,
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
        let store = self.store.as_ref().ok_or(AuthError::Disabled)?;
        let mut transaction = store.lock(owner).await?;
        let started = now()?;
        if transaction
            .state()
            .attempt
            .as_ref()
            .is_some_and(|attempt| started.saturating_sub(attempt.started) < 2)
        {
            return Err(AuthError::Busy);
        }
        let state = random_secret();
        let verifier = Secret::parse(random_secret())?;
        let attempt_id = random_secret();
        let authorization_url = self.provider.authorization_url(&state, &verifier);
        transaction.state().attempt = Some(Attempt {
            id: attempt_id.clone(),
            state,
            verifier: Some(verifier),
            started,
        });
        transaction.commit().await?;
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
            let mut transaction = store.lock(owner).await?;
            let attempt = transaction
                .state()
                .attempt
                .as_mut()
                .ok_or(AuthError::InvalidAttempt)?;
            if attempt.id != attempt_id
                || now()?.saturating_sub(attempt.started) >= LOGIN_TTL.as_secs()
            {
                return Err(AuthError::InvalidAttempt);
            }
            if !bool::from(attempt.state.as_bytes().ct_eq(state.as_bytes())) {
                return Err(AuthError::InvalidCode);
            }
            // Taking the verifier consumes the attempt before making any network request.
            let verifier = attempt.verifier.take().ok_or(AuthError::InvalidAttempt)?;
            transaction.commit().await?;
            verifier
        };
        let result = self
            .provider
            .exchange(Secret::parse(code.to_owned())?, state, verifier)
            .await;
        let mut transaction = store.lock(owner).await?;
        if !transaction.state().attempt.as_ref().is_some_and(|attempt| {
            attempt.id == attempt_id
                && now()
                    .is_ok_and(|time| time.saturating_sub(attempt.started) < LOGIN_TTL.as_secs())
        }) {
            return Err(AuthError::InvalidAttempt);
        }
        transaction.state().attempt = None;
        match result {
            Ok(grant) => {
                transaction.state().grant = Some(grant);
                transaction.state().refresh_id = None;
                transaction.commit().await?;
            }
            Err(error) => {
                transaction.commit().await?;
                return Err(error.into());
            }
        }
        Ok(())
    }

    async fn disconnect(&self, owner: &str) -> Result<(), AuthError> {
        let store = self.store.as_ref().ok_or(AuthError::Disabled)?;
        let mut transaction = store.lock(owner).await?;
        *transaction.state() = ConnectionState::default();
        transaction.commit().await?;
        Ok(())
    }
}

#[cfg(test)]
mod test;
