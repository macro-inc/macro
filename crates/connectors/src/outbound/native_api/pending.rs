//! Sign-ins started and not yet finished, keyed by their one-time OAuth
//! `state`, kept in Redis apart from the connection row as the native
//! source keeps its own. Taking one deletes it, so a state is spent once.

use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use redis::AsyncCommands as _;
use rootcause::Report;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// The Redis key prefix.
const KEY_PREFIX: &str = "connectors:api_app_sign_in:";
/// How long a started sign-in may take, as the web's connect flow waits.
const TTL_SECONDS: u64 = 600;

/// A started sign-in.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct PendingSignIn {
    /// Who started it.
    pub(crate) user: String,
    /// The app being connected.
    pub(crate) app: String,
    /// The PKCE verifier, sent with the code.
    pub(crate) verifier: String,
}

impl std::fmt::Debug for PendingSignIn {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PendingSignIn")
            .field("app", &self.app)
            .finish_non_exhaustive()
    }
}

impl PendingSignIn {
    /// The user who started it.
    pub(crate) fn user(&self) -> Result<MacroUserIdStr<'static>, Report> {
        MacroUserIdStr::parse_from_str(&self.user)
            .map(|user| user.into_owned())
            .map_err(|_| rootcause::report!("a pending sign-in names no user"))
    }
}

/// Where started sign-ins wait.
///
/// Object-safe (`#[async_trait]`): the source holds it as `Arc<dyn _>`.
#[async_trait::async_trait]
pub(crate) trait PendingSignIns: Send + Sync {
    /// Keep `pending` under `state` until it is taken or expires.
    async fn save(&self, state: &str, pending: &PendingSignIn) -> Result<(), Report>;

    /// Take the sign-in under `state`, if it has not expired or been taken.
    async fn take(&self, state: &str) -> Result<Option<PendingSignIn>, Report>;
}

/// [`PendingSignIns`] in Redis.
pub(crate) struct RedisPendingSignIns {
    client: Arc<redis::Client>,
}

impl RedisPendingSignIns {
    pub(crate) fn new(client: Arc<redis::Client>) -> Self {
        Self { client }
    }
}

#[async_trait::async_trait]
impl PendingSignIns for RedisPendingSignIns {
    #[tracing::instrument(name = "connectors.api_app_sign_in_save", skip_all, err)]
    async fn save(&self, state: &str, pending: &PendingSignIn) -> Result<(), Report> {
        let value = serde_json::to_string(pending).map_err(Report::new)?;
        let mut connection = self
            .client
            .get_multiplexed_async_connection()
            .await
            .map_err(Report::new)?;
        connection
            .set_ex::<_, _, ()>(format!("{KEY_PREFIX}{state}"), value, TTL_SECONDS)
            .await
            .map_err(Report::new)?;
        Ok(())
    }

    #[tracing::instrument(name = "connectors.api_app_sign_in_take", skip_all, err)]
    async fn take(&self, state: &str) -> Result<Option<PendingSignIn>, Report> {
        let mut connection = self
            .client
            .get_multiplexed_async_connection()
            .await
            .map_err(Report::new)?;
        let value: Option<String> = connection
            .get_del(format!("{KEY_PREFIX}{state}"))
            .await
            .map_err(Report::new)?;
        value
            .map(|value| serde_json::from_str(&value).map_err(Report::new))
            .transpose()
            .map_err(Report::into_dynamic)
    }
}

/// [`PendingSignIns`] in memory, for tests.
#[cfg(test)]
#[derive(Default)]
pub(crate) struct MemoryPendingSignIns {
    pending: std::sync::Mutex<std::collections::HashMap<String, PendingSignIn>>,
}

#[cfg(test)]
#[async_trait::async_trait]
impl PendingSignIns for MemoryPendingSignIns {
    async fn save(&self, state: &str, pending: &PendingSignIn) -> Result<(), Report> {
        self.pending
            .lock()
            .unwrap()
            .insert(state.to_owned(), pending.clone());
        Ok(())
    }

    async fn take(&self, state: &str) -> Result<Option<PendingSignIn>, Report> {
        Ok(self.pending.lock().unwrap().remove(state))
    }
}
