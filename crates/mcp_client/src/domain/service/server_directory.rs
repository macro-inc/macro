//! Adding custom MCP servers to a user's connections.
//!
//! The settings dialog and the `ConnectMcpServer` AI tool both add servers
//! through here, so a server added either way is the same row.

use crate::domain::models::{MacroUserIdStr, McpServerRecord};
use crate::domain::ports::McpServerStore;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Why a server could not be added.
#[derive(Debug, thiserror::Error)]
pub enum AddServerError {
    /// The URL is not an absolute `http` or `https` URL.
    #[error("`{0}` is not an http(s) URL")]
    InvalidUrl(String),
    /// The server name is empty.
    #[error("the server name is empty")]
    EmptyName,
    /// The store failed.
    #[error(transparent)]
    Store(anyhow::Error),
}

/// A server added by [`ServerDirectory::add`].
#[derive(Debug)]
pub enum AddedServer {
    /// The user had no server at this URL; it is stored now, without
    /// credentials.
    New(McpServerRecord),
    /// The user already had this URL, so the stored row is left untouched.
    Existing(McpServerRecord),
}

impl AddedServer {
    /// The stored row.
    pub fn record(&self) -> &McpServerRecord {
        match self {
            Self::New(record) | Self::Existing(record) => record,
        }
    }
}

/// A user's custom MCP servers.
pub struct ServerDirectory<Store> {
    store: Arc<Store>,
}

impl<Store> Clone for ServerDirectory<Store> {
    fn clone(&self) -> Self {
        Self {
            store: self.store.clone(),
        }
    }
}

impl<Store> ServerDirectory<Store>
where
    Store: McpServerStore,
    anyhow::Error: From<Store::Err>,
{
    /// A directory over `store`.
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }

    /// Add `url` to `user_id`'s servers under `server_name`, enabled and
    /// without credentials; the user signs in afterwards through OAuth.
    ///
    /// A URL the user already has is returned as stored. Saving over it
    /// would wipe the grant it holds.
    #[tracing::instrument(skip(self), err)]
    pub async fn add(
        &self,
        user_id: MacroUserIdStr<'static>,
        url: &str,
        server_name: &str,
    ) -> Result<AddedServer, AddServerError> {
        let url = url.trim();
        let server_name = server_name.trim();
        match url::Url::parse(url) {
            Ok(parsed) if matches!(parsed.scheme(), "http" | "https") => {}
            _ => return Err(AddServerError::InvalidUrl(url.to_owned())),
        }
        if server_name.is_empty() {
            return Err(AddServerError::EmptyName);
        }

        if let Some(existing) = self
            .store
            .load(&user_id, url)
            .await
            .map_err(|error| AddServerError::Store(error.into()))?
        {
            return Ok(AddedServer::Existing(existing));
        }

        let record = McpServerRecord {
            user_id,
            url: url.to_owned(),
            server_name: server_name.to_owned(),
            credentials: None,
            enabled: true,
        };
        self.store
            .save(&record)
            .await
            .map_err(|error| AddServerError::Store(error.into()))?;
        Ok(AddedServer::New(record))
    }
}
