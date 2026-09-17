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
#[cfg(test)]
pub(crate) mod test_support;

/// Encrypted connection state shared across service replicas.
#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ConnectionState {
    /// The owner's subscription grant, if connected.
    pub grant: Option<Credentials>,
    /// Pending, owner-bound browser consent.
    pub attempt: Option<super::auth::Attempt>,
    /// A consumed refresh must never be retried after an uncertain exchange.
    pub refresh_id: Option<String>,
}

/// Owner-scoped transaction. Dropping it rolls back uncommitted state.
#[async_trait::async_trait]
pub trait GrantTransaction: Send {
    /// Read or update the locked state.
    fn state(&mut self) -> &mut ConnectionState;
    /// Persist the state and release the owner lock.
    async fn commit(self: Box<Self>) -> Result<()>;
}

/// Persistence serializes connection changes across replicas.
#[async_trait::async_trait]
pub trait GrantRepository: Send + Sync {
    /// Lock exactly one owner's state, including owners with no existing row.
    async fn lock(&self, owner: &str) -> Result<Box<dyn GrantTransaction>>;
    /// Load one grant without returning pending consent secrets.
    async fn get(&self, owner: &str) -> Result<Option<Credentials>> {
        Ok(self.lock(owner).await?.state().grant.clone())
    }
    /// Persist a new connection and invalidate pending consent or refresh.
    async fn put(&self, owner: &str, grant: &Credentials) -> Result<()> {
        let mut transaction = self.lock(owner).await?;
        *transaction.state() = ConnectionState {
            grant: Some(grant.clone()),
            ..Default::default()
        };
        transaction.commit().await
    }
    /// Forget this owner's connection and any pending consent.
    async fn delete(&self, owner: &str) -> Result<()> {
        let mut transaction = self.lock(owner).await?;
        *transaction.state() = ConnectionState::default();
        transaction.commit().await
    }
}

/// Provider refresh capability; never retries a token exchange automatically.
#[async_trait::async_trait]
pub trait RefreshGrant: Send + Sync {
    /// Refresh an expired grant.
    async fn refresh(&self, grant: &Credentials) -> Result<Credentials>;
}

/// Owner-scoped credential lifecycle with durable refresh consumption.
#[derive(Clone)]
pub struct AccountCredentials {
    repository: Arc<dyn GrantRepository>,
    refresher: Arc<dyn RefreshGrant>,
    // Keep rotated grants after a persistence failure so we never reuse an old
    // refresh token. The next operation retries persistence before using them.
    pending: Arc<Mutex<BTreeMap<String, (String, Credentials)>>>,
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
        let mut transaction = self.repository.lock(owner).await?;
        if let Some((id, grant)) = pending.remove(owner)
            && transaction.state().refresh_id.as_ref() == Some(&id)
        {
            transaction.state().grant = Some(grant.clone());
            transaction.state().refresh_id = None;
            if let Err(error) = transaction.commit().await {
                pending.insert(owner.to_owned(), (id, grant));
                return Err(error);
            }
            transaction = self.repository.lock(owner).await?;
        }
        if transaction.state().refresh_id.is_some() {
            return Err(Error::Authorization);
        }
        let grant = transaction
            .state()
            .grant
            .clone()
            .ok_or(Error::NotConnected)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| Error::Credentials)?
            .as_secs();
        if grant.expires_at > now + 120 {
            return Ok(grant);
        }
        // Persist consumption before the external mutation. A crashed process
        // cannot cause another replica to reuse a rotating refresh token.
        let id = uuid::Uuid::now_v7().to_string();
        transaction.state().refresh_id = Some(id.clone());
        transaction.commit().await?;
        let refreshed = self.refresher.refresh(&grant).await?;
        let mut transaction = self.repository.lock(owner).await?;
        if transaction.state().refresh_id.as_ref() != Some(&id) {
            return Err(Error::NotConnected);
        }
        transaction.state().grant = Some(refreshed.clone());
        transaction.state().refresh_id = None;
        if let Err(error) = transaction.commit().await {
            pending.insert(owner.to_owned(), (id, refreshed));
            return Err(error);
        }
        Ok(refreshed)
    }
}

impl ConnectionStore for AccountCredentials {
    async fn lock(&self, owner: &str) -> Result<Box<dyn GrantTransaction>> {
        self.repository.lock(owner).await
    }
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
