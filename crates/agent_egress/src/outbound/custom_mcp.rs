//! Resolving a key to one of the owner's custom MCP servers.
//!
//! A custom server is one the owner added by URL under Agents → Connections,
//! with Macro's own OAuth client holding the grant - the native stack in
//! `mcp_client`, as opposed to the Pipedream one. The rows carry the owner's
//! encrypted tokens, which is exactly why this traffic must flow through the
//! proxy: the token is the owner's, the sandbox must never hold it, and
//! somebody has to refresh it when it expires.
//!
//! Both halves come from `mcp_client`'s own port and service - the same rows
//! the chat tool path reads, the same refresh-and-persist the in-process
//! connector runs - so a server connected in Macro is a server the sandbox
//! can reach, with nothing to keep in sync.

use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::models::McpServerRecord;
use mcp_client::domain::ports::McpServerStore;
use mcp_client::domain::service::{ServerAccess, server_access};
use std::sync::Arc;
use url::Url;

use crate::domain::error::EgressError;
use crate::domain::model::{
    BearerToken, CustomMcpServerKey, McpDestination, McpResolution, UpstreamCall,
};
use crate::domain::ports::McpCredentials;

#[cfg(test)]
mod test;

/// Layers the owner's custom MCP servers over another resolver.
///
/// [`McpDestination::Custom`] is answered here; everything else passes
/// straight through to `Inner`. The destinations arrive from different
/// routes, so there is no name for a connected app to collide with.
pub struct WithCustomMcp<Inner, Servers> {
    inner: Inner,
    servers: Arc<Servers>,
}

impl<Inner, Servers> WithCustomMcp<Inner, Servers>
where
    Inner: McpCredentials,
    Servers: McpServerStore,
{
    /// Wrap `inner`, answering [`McpDestination::Custom`] from the rows in
    /// `servers`.
    pub fn new(inner: Inner, servers: Arc<Servers>) -> Self {
        Self { inner, servers }
    }

    /// The owner's enabled server whose URL hashes to `key`, if they hold
    /// one.
    ///
    /// Scoped to the owner by the store call itself, and filtered to
    /// `enabled` here because the store does not: a disabled server is one
    /// the owner turned off, and turning it off has to take the sandbox's
    /// access with it.
    async fn record(
        &self,
        owner: &MacroUserIdStr<'static>,
        key: &CustomMcpServerKey,
    ) -> Result<Option<McpServerRecord>, EgressError> {
        Ok(self
            .servers
            .list(owner)
            .await
            .map_err(|error| {
                EgressError::Internal(rootcause::report!(
                    "could not list custom MCP servers: {error:?}"
                ))
            })?
            .into_iter()
            .filter(|record| record.enabled)
            // The same derivation the provisioner advertised, over the same
            // column; equality is the whole match.
            .find(|record| CustomMcpServerKey::for_url(&record.url) == *key))
    }
}

impl<Inner, Servers> McpCredentials for WithCustomMcp<Inner, Servers>
where
    Inner: McpCredentials,
    Servers: McpServerStore,
{
    #[tracing::instrument(skip_all, err, fields(%owner, ?destination))]
    async fn resolve(
        &self,
        owner: &MacroUserIdStr<'static>,
        destination: &McpDestination,
    ) -> Result<McpResolution, EgressError> {
        let McpDestination::Custom(key) = destination else {
            return self.inner.resolve(owner, destination).await;
        };

        // Unlike a Pipedream slug there is nothing to address without a row:
        // the URL *is* the row.
        let record = self
            .record(owner, key)
            .await?
            .ok_or_else(|| EgressError::UnknownCustomServer(key.clone()))?;

        // The row's URL is the owner's typing, stored verbatim. One that is
        // not a URL could never have been connected, so it is a broken row
        // rather than a refusal of anything the sandbox asked for.
        let url = Url::parse(&record.url).map_err(|error| {
            EgressError::Internal(rootcause::report!(
                "custom MCP server {} has a URL that does not parse: {error}",
                record.server_name
            ))
        })?;

        // Token freshness is the service's: a live token comes straight off
        // the row, an expiring one is refreshed and the rotated grant written
        // back for whoever reads it next.
        let access = server_access(&record, Arc::clone(&self.servers))
            .await
            .map_err(|error| {
                EgressError::Upstream(rootcause::report!(
                    "could not refresh the grant for custom MCP server {}: {error}",
                    record.server_name
                ))
            })?;

        // Typed at the source, but not yet vetted: `UpstreamCall`'s
        // constructors are what refuse a non-https endpoint, and they are the
        // only way to pair this URL with a credential - or with none.
        Ok(match access {
            ServerAccess::Anonymous => McpResolution::Connected(UpstreamCall::anonymous(url)?),
            ServerAccess::Bearer(token) => {
                McpResolution::Connected(UpstreamCall::bearer(url, BearerToken::new(token))?)
            }
            ServerAccess::AuthorizationRequired => McpResolution::Disconnected {
                call: UpstreamCall::anonymous(url)?,
                name: record.server_name,
            },
        })
    }
}
