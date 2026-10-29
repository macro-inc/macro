//! Adding custom MCP servers to a user's connections.
//!
//! The settings dialog and the `ConnectMcpServer` AI tool both add servers
//! through here, so a server added either way is the same row.

use crate::domain::models::{MacroUserIdStr, McpServerRecord};
use crate::domain::ports::McpServerStore;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::sync::Arc;
use url::{Host, Url};

#[cfg(test)]
mod test;

/// Why a server could not be added.
#[derive(Debug, thiserror::Error)]
pub enum AddServerError {
    /// The URL is not an absolute `http` or `https` URL.
    #[error("`{0}` is not an http(s) URL")]
    InvalidUrl(String),
    /// An agent named a destination it may not add: not `https`, or not on
    /// the public internet.
    #[error("`{0}` is not a public https URL")]
    NonPublicDestination(String),
    /// The server name is empty.
    #[error("the server name is empty")]
    EmptyName,
    /// The store failed.
    #[error(transparent)]
    Store(anyhow::Error),
}

/// Who is adding a server, which decides the destinations allowed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddedBy {
    /// The user, by URL in settings.
    User,
    /// An agent acting for the user. The backend later connects to the URL,
    /// so an agent may only add public `https` destinations: a prompt must
    /// not be able to aim Macro at loopback, private or link-local hosts.
    Agent,
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
        added_by: AddedBy,
    ) -> Result<AddedServer, AddServerError> {
        let url = url.trim();
        let server_name = server_name.trim();
        let parsed = match Url::parse(url) {
            Ok(parsed) if matches!(parsed.scheme(), "http" | "https") => parsed,
            _ => return Err(AddServerError::InvalidUrl(url.to_owned())),
        };
        if added_by == AddedBy::Agent && !is_public_https(&parsed) {
            return Err(AddServerError::NonPublicDestination(url.to_owned()));
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

/// Whether `url` is `https` to a host on the public internet.
///
/// Hostnames are judged by name only: `localhost` and `.localhost`,
/// `.local` and `.internal` names are refused, while a public-looking name
/// is not resolved here.
fn is_public_https(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    match url.host() {
        Some(Host::Domain(domain)) => {
            let domain = domain.trim_end_matches('.').to_ascii_lowercase();
            !(domain == "localhost"
                || domain.ends_with(".localhost")
                || domain.ends_with(".local")
                || domain.ends_with(".internal"))
        }
        Some(Host::Ipv4(address)) => is_public_ipv4(address),
        Some(Host::Ipv6(address)) => is_public_ipv6(address),
        None => false,
    }
}

fn is_public_ipv4(address: Ipv4Addr) -> bool {
    let [first, second, ..] = address.octets();
    !(address.is_unspecified()
        || address.is_loopback()
        || address.is_private()
        || address.is_link_local()
        || address.is_broadcast()
        || address.is_documentation()
        || address.is_multicast()
        // Carrier-grade NAT, 100.64.0.0/10.
        || (first == 100 && (second & 0b1100_0000) == 64)
        // "This network", 0.0.0.0/8.
        || first == 0)
}

fn is_public_ipv6(address: Ipv6Addr) -> bool {
    if let Some(mapped) = address.to_ipv4_mapped() {
        return is_public_ipv4(mapped);
    }
    let first = address.segments()[0];
    !(address.is_unspecified()
        || address.is_loopback()
        || address.is_multicast()
        // Unique local, fc00::/7.
        || (first & 0xfe00) == 0xfc00
        // Link-local, fe80::/10.
        || (first & 0xffc0) == 0xfe80)
}
