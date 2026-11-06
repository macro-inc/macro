//! Write-through OAuth credential store for MCP connections.
//!
//! See [`PersistingCredentialStore`].

use crate::domain::{
    models::{McpServerRecord, StoredCredentials},
    ports::McpServerStore,
};
use rmcp::transport::auth::{AuthError, CredentialStore, InMemoryCredentialStore};
use std::sync::Arc;

#[cfg(test)]
mod test;

/// An rmcp [`CredentialStore`] that serves reads from memory and persists
/// every write back to the [`McpServerStore`].
///
/// Providers such as Linear rotate refresh tokens on every refresh: the
/// moment a new token pair is issued, the previous refresh token is
/// invalidated. rmcp refreshes lazily and writes the new credentials to its
/// credential store; when that store is purely in-memory, the rotated grant
/// is dropped at the end of the request and every subsequent connection
/// retries the invalidated grant still sitting in the database, forcing the
/// user to re-authorize roughly every access-token lifetime. Writing saves
/// through to the persistent store keeps the database in sync with the
/// authorization server.
pub struct PersistingCredentialStore<S> {
    inner: InMemoryCredentialStore,
    server_store: Arc<S>,
    record: McpServerRecord,
}

impl<S> PersistingCredentialStore<S> {
    /// Create a store for `record` that persists updates via `server_store`.
    ///
    /// The store starts empty; seed it with the record's current credentials
    /// via [`PersistingCredentialStore::seed`] before handing it to rmcp.
    pub fn new(record: McpServerRecord, server_store: Arc<S>) -> Self {
        Self {
            inner: InMemoryCredentialStore::new(),
            server_store,
            record,
        }
    }

    /// Seed the in-memory store without persisting.
    ///
    /// Used to load the already-persisted credentials into a fresh connection
    /// without triggering a redundant write back to the database.
    pub async fn seed(&self, credentials: StoredCredentials) -> Result<(), AuthError> {
        self.inner.save(credentials).await
    }
}

#[async_trait::async_trait]
impl<S> CredentialStore for PersistingCredentialStore<S>
where
    S: McpServerStore,
{
    async fn load(&self) -> Result<Option<StoredCredentials>, AuthError> {
        self.inner.load().await
    }

    async fn save(&self, credentials: StoredCredentials) -> Result<(), AuthError> {
        self.inner.save(credentials.clone()).await?;

        let mut record = self.record.clone();
        record.credentials = Some(credentials);
        if let Err(error) = self.server_store.save(&record).await {
            // The in-memory credentials stay usable for the remainder of
            // this connection. A failed persist only means the next
            // connection refreshes again (or, if the provider rotated
            // grants, requires re-authorization), so log and continue.
            tracing::error!(
                server = %record.server_name,
                error = ?error,
                "failed to persist refreshed MCP credentials"
            );
        }
        Ok(())
    }

    async fn clear(&self) -> Result<(), AuthError> {
        // Session-local only: never drop the persisted credentials.
        self.inner.clear().await
    }
}
