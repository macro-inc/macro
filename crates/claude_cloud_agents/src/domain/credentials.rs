//! Owner-scoped grant lifecycle, shared by browser consent and provider calls.
use super::{
    auth::ConnectionStore,
    model::{Credentials, Error, Result},
};
use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;

#[cfg(test)]
mod test;

/// Persistence stores only the requested owner's grant.
#[async_trait::async_trait]
pub trait GrantRepository: Send + Sync {
    /// Load one grant.
    async fn get(&self, owner: &str) -> Result<Option<Credentials>>;
    /// Persist one grant, including refresh-token rotation.
    async fn put(&self, owner: &str, grant: &Credentials) -> Result<()>;
    /// Forget one grant.
    async fn delete(&self, owner: &str) -> Result<()>;
}

/// Provider refresh capability; never retries a token exchange automatically.
#[async_trait::async_trait]
pub trait RefreshGrant: Send + Sync {
    /// Refresh an expired grant.
    async fn refresh(&self, grant: &Credentials) -> Result<Credentials>;
}

/// Single-replica demo service. Serializes refresh, connect, and disconnect.
#[derive(Clone)]
pub struct AccountCredentials {
    repository: Arc<dyn GrantRepository>,
    refresher: Arc<dyn RefreshGrant>,
    // Keep rotated grants after a persistence failure so we never reuse an old
    // refresh token. The next operation retries persistence before using them.
    pending: Arc<Mutex<BTreeMap<String, Credentials>>>,
}

impl AccountCredentials {
    /// Wire persistence and refresh ports at the composition root.
    pub fn new(repository: Arc<dyn GrantRepository>, refresher: Arc<dyn RefreshGrant>) -> Self {
        Self {
            repository,
            refresher,
            pending: Arc::default(),
        }
    }

    /// Presence for this exact owner, without exposing a grant.
    pub async fn contains(&self, owner: &str) -> bool {
        self.repository.get(owner).await.ok().flatten().is_some()
    }

    /// Resolve and persist a refresh before a provider operation.
    pub async fn resolve(&self, owner: &str) -> Result<Credentials> {
        let mut pending = self.pending.lock().await;
        if let Some(grant) = pending.get(owner) {
            self.repository.put(owner, grant).await?;
            pending.remove(owner);
        }
        let grant = self
            .repository
            .get(owner)
            .await?
            .ok_or(Error::NotConnected)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| Error::Credentials)?
            .as_secs();
        if grant.expires_at > now + 120 {
            return Ok(grant);
        }
        let refreshed = self.refresher.refresh(&grant).await?;
        pending.insert(owner.to_owned(), refreshed.clone());
        self.repository.put(owner, &refreshed).await?;
        pending.remove(owner);
        Ok(refreshed)
    }
}

impl ConnectionStore for AccountCredentials {
    async fn connected(&self, owner: &str) -> bool {
        self.contains(owner).await
    }
    async fn save(&self, owner: &str, grant: Credentials) -> Result<()> {
        let mut pending = self.pending.lock().await;
        self.repository.put(owner, &grant).await?;
        pending.remove(owner);
        Ok(())
    }
    async fn remove(&self, owner: &str) -> Result<()> {
        let mut pending = self.pending.lock().await;
        self.repository.delete(owner).await?;
        pending.remove(owner);
        Ok(())
    }
}
