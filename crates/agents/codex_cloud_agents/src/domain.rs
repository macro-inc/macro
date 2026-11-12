//! Device-login lifecycle independent of HTTP and filesystem implementation.

use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use zeroize::Zeroize;

#[cfg(test)]
mod test;

/// Durable cloud conversation orchestration for ACP clients.
pub mod acp_session;
/// Cloud task commands and observations used by the feasibility probe.
pub mod cloud;
/// Native append-only inputs and deterministic replay.
pub mod journal;

/// An opaque secret. It deliberately has no Debug or Display implementation.
#[derive(Serialize, Deserialize)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    /// Validate an opaque token without including its value in errors.
    pub fn new(value: String) -> Result<Self, rootcause::Report> {
        if value.is_empty() || value.len() > 128 * 1024 || value.chars().any(char::is_control) {
            return Err(rootcause::report!("invalid credential value"));
        }
        Ok(Self(value))
    }

    /// Expose only at the provider or persistence boundary.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl Drop for Secret {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

/// ChatGPT OAuth credentials, kept private by the chosen credential adapter.
#[derive(Serialize, Deserialize)]
pub struct Credentials {
    /// Format version, checked on load.
    pub version: u8,
    /// Bearer credential.
    pub access_token: Secret,
    /// Rotating refresh credential.
    pub refresh_token: Secret,
    /// Unix seconds at which the access token expires.
    pub expires_at: u64,
    /// Account identifier extracted from the trusted token exchange response.
    /// This metadata is not independent JWT identity verification.
    pub account_id: String,
}

impl Credentials {
    /// Reject malformed credential state before provider use.
    pub fn validate(&self) -> Result<(), rootcause::Report> {
        if self.version != 1
            || self.expires_at == 0
            || self.account_id.is_empty()
            || self.account_id.len() > 256
            || !self
                .account_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
            || self.access_token.expose().is_empty()
            || self.refresh_token.expose().is_empty()
            || self.access_token.expose().chars().any(char::is_control)
            || self.refresh_token.expose().chars().any(char::is_control)
        {
            return Err(rootcause::report!(
                "invalid stored credentials; log in again"
            ));
        }
        Ok(())
    }
}

/// Pending device login. Never log this structure as a whole.
pub struct DeviceLogin {
    /// URL shown to the account holder.
    pub verification_url: String,
    /// Short one-time code shown to the account holder.
    pub user_code: String,
    /// Private handle used for polling.
    pub device_auth_id: Secret,
    /// Minimum delay between polling requests.
    pub interval: Duration,
    /// Maximum local waiting period.
    pub timeout: Duration,
}

/// Result of a single device poll.
pub enum LoginPoll {
    /// OpenAI has not completed the browser verification.
    Pending,
    /// Tokens have been exchanged successfully.
    Complete(Credentials),
}

/// Provider operations needed for this first feasibility milestone.
pub trait OAuth: Send + Sync {
    /// Begin a fresh device authorization.
    fn begin(&self) -> impl Future<Output = Result<DeviceLogin, rootcause::Report>> + Send;
    /// Poll once and exchange an authorization code when available.
    fn poll(
        &self,
        login: &DeviceLogin,
    ) -> impl Future<Output = Result<LoginPoll, rootcause::Report>> + Send;
    /// Rotate an expired access credential.
    fn refresh(
        &self,
        current: &Credentials,
    ) -> impl Future<Output = Result<Credentials, rootcause::Report>> + Send;
    /// Read safe environment metadata using this account.
    fn environments(
        &self,
        credentials: &Credentials,
    ) -> impl Future<Output = Result<Vec<Environment>, rootcause::Report>> + Send;
}

/// Safe subset of a cloud environment; never prints setup scripts or secrets.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Environment {
    /// Provider identifier.
    pub id: String,
    /// Human-readable label, if present.
    pub label: Option<String>,
    /// Ordered, validated repositories; empty when complete metadata is unavailable.
    pub repositories: Vec<EnvironmentRepository>,
}

/// Repository identity projected from provider metadata, never from an environment label.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct EnvironmentRepository {
    /// Provider owner/repository name.
    pub full_name: String,
    /// HTTPS clone URL without credentials, query, or fragment.
    pub clone_url: String,
    /// Provider default branch.
    pub default_branch: String,
}

/// Local persistence, exclusively locked by its composition root for a command.
pub trait CredentialStore {
    /// Load the probe's credentials only.
    fn load(&self) -> Result<Option<Credentials>, rootcause::Report>;
    /// Atomically replace credentials.
    fn save(&self, credentials: &Credentials) -> Result<(), rootcause::Report>;
    /// Delete only this probe's saved credentials.
    fn clear(&self) -> Result<(), rootcause::Report>;
}

/// Orchestrates login and refresh while preserving account binding.
pub struct Probe<Provider, Store> {
    provider: Provider,
    store: Store,
    refresh_lock: tokio::sync::Mutex<()>,
}

impl<Provider: OAuth, Store: CredentialStore> Probe<Provider, Store> {
    /// Compose independently testable provider and storage adapters.
    pub fn new(provider: Provider, store: Store) -> Self {
        Self {
            provider,
            store,
            refresh_lock: tokio::sync::Mutex::new(()),
        }
    }

    /// Start a fresh login without overwriting an existing connection.
    pub async fn begin_login(&self) -> Result<DeviceLogin, rootcause::Report> {
        if self.store.load()?.is_some() {
            return Err(rootcause::report!(
                "already connected; run logout before switching accounts"
            ));
        }
        self.provider.begin().await
    }

    /// Await verification, then persist once. Dropping the future cancels local waiting.
    pub async fn finish_login(&self, login: &DeviceLogin) -> Result<(), rootcause::Report> {
        let wait = async {
            loop {
                match self.provider.poll(login).await? {
                    LoginPoll::Complete(credentials) => {
                        credentials.validate()?;
                        return self.store.save(&credentials);
                    }
                    LoginPoll::Pending => tokio::time::sleep(login.interval).await,
                }
            }
        };
        tokio::time::timeout(login.timeout, wait)
            .await
            .map_err(|_| rootcause::report!("device login expired; run login again"))?
    }

    /// Inspect local state; no network request or token refresh.
    pub fn status(&self) -> Result<Option<Credentials>, rootcause::Report> {
        self.store.load()
    }

    /// Forget local credentials; does not revoke or cancel anything at OpenAI.
    pub fn logout(&self) -> Result<(), rootcause::Report> {
        self.store.clear()
    }

    /// Query cloud environments, refreshing expiring credentials once beforehand.
    pub async fn environments(&self, now: u64) -> Result<Vec<Environment>, rootcause::Report> {
        let credentials = self.credentials(now).await?;
        self.provider.environments(&credentials).await
    }

    async fn credentials(&self, now: u64) -> Result<Credentials, rootcause::Report> {
        let _refresh_guard = self.refresh_lock.lock().await;
        let mut credentials = self
            .store
            .load()?
            .ok_or_else(|| rootcause::report!("not connected; run login first"))?;
        if credentials.expires_at <= now.saturating_add(60) {
            let refreshed = self.provider.refresh(&credentials).await?;
            refreshed.validate()?;
            if refreshed.account_id != credentials.account_id {
                return Err(rootcause::report!("refresh changed account; log in again"));
            }
            self.store.save(&refreshed)?;
            credentials = refreshed;
        }
        Ok(credentials)
    }
}

/// Current Unix seconds for the CLI composition root.
pub fn unix_now() -> Result<u64, rootcause::Report> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs())
}

/// Authenticated cloud operation port for local and hosted runtimes.
pub mod runtime;
