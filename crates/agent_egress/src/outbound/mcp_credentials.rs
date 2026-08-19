//! Resolving a slug to one of the owner's connected MCP servers, with a live
//! token.
//!
//! The freshness is rmcp's: `AuthorizationManager::get_access_token` refreshes
//! a grant that is near expiry and writes the rotated one back through the
//! credential store, which here is `mcp_client`'s
//! [`PersistingCredentialStore`] - the same one the MCP tool path uses, so a
//! refresh triggered by a sandbox and one triggered by a chat message land in
//! the same row. Reusing it is the point: a second store would rotate a token
//! the other path then fails to find.

use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::models::McpServerRecord;
use mcp_client::domain::ports::McpServerStore;
use mcp_client::domain::service::PersistingCredentialStore;
use rmcp::transport::auth::{AuthError, AuthorizationManager};
use std::sync::Arc;
use url::Url;

use crate::domain::error::EgressError;
use crate::domain::model::{BearerToken, McpServerSlug, UpstreamCall};
use crate::domain::ports::McpCredentials;

/// Resolves MCP slugs against an owner's stored server records.
pub struct RmcpMcpCredentials<Servers> {
    servers: Arc<Servers>,
}

impl<Servers> RmcpMcpCredentials<Servers>
where
    Servers: McpServerStore,
{
    /// Build the adapter over the store holding the owner's servers.
    pub fn new(servers: Arc<Servers>) -> Self {
        Self { servers }
    }

    /// The owner's enabled server whose name slugs to `slug`.
    ///
    /// Scoped to the owner by the store call itself, and filtered to `enabled`
    /// here because the store does not: a disabled server is one the owner
    /// turned off, and turning it off has to take the sandbox's access with it.
    async fn record(
        &self,
        owner: &MacroUserIdStr<'static>,
        slug: &McpServerSlug,
    ) -> Result<McpServerRecord, EgressError> {
        self.servers
            .list(owner)
            .await
            .map_err(|error| {
                EgressError::Internal(rootcause::report!(
                    "could not list connected MCP servers: {error:?}"
                ))
            })?
            .into_iter()
            .filter(|record| record.enabled)
            .find(|record| {
                McpServerSlug::from_server_name(&record.server_name).as_ref() == Some(slug)
            })
            .ok_or_else(|| EgressError::UnknownServer(slug.clone()))
    }
}

impl<Servers> McpCredentials for RmcpMcpCredentials<Servers>
where
    Servers: McpServerStore,
{
    #[tracing::instrument(skip_all, err, fields(%owner, %slug))]
    async fn resolve(
        &self,
        owner: &MacroUserIdStr<'static>,
        slug: &McpServerSlug,
    ) -> Result<UpstreamCall, EgressError> {
        let record = self.record(owner, slug).await?;

        // Parsed, but not yet vetted: `UpstreamCall`'s constructor is what
        // refuses a non-https server, and it is the only way to pair this URL
        // with a credential.
        let url = Url::parse(&record.url).map_err(|error| {
            EgressError::Internal(rootcause::report!(
                "stored MCP server url is not a url: {error}"
            ))
        })?;

        // No stored grant at all is the same fact as one that cannot be
        // refreshed: the owner has to reconnect the server.
        let credentials = record
            .credentials
            .clone()
            .ok_or_else(|| EgressError::NeedsReauthorization(slug.clone()))?;

        // The order matters and is `McpServerRecord::connect`'s: seed the store
        // with what we have, hand it to the manager, then let the manager
        // discover the server's OAuth metadata. Without the last step the
        // manager has no client to refresh with, so any expired grant fails.
        let mut authorization = AuthorizationManager::new(&record.url)
            .await
            .map_err(|error| authorization_error(slug, error))?;
        let store = PersistingCredentialStore::new(record, Arc::clone(&self.servers));
        store
            .seed(credentials)
            .await
            .map_err(|error| authorization_error(slug, error))?;
        authorization.set_credential_store(store);
        authorization
            .initialize_from_store()
            .await
            .map_err(|error| authorization_error(slug, error))?;

        let token = authorization
            .get_access_token()
            .await
            .map_err(|error| authorization_error(slug, error))?;

        UpstreamCall::bearer(url, BearerToken::new(token))
    }
}

/// Split rmcp's auth failures by what the caller should do.
///
/// The distinction is the reason [`EgressError::NeedsReauthorization`] exists:
/// a grant that cannot be refreshed needs a person, and an agent told only
/// "error" will retry it until its turn times out. Everything else is
/// somebody's server or network being unreachable, which is worth retrying.
fn authorization_error(slug: &McpServerSlug, error: AuthError) -> EgressError {
    match error {
        AuthError::AuthorizationRequired
        | AuthError::TokenExpired
        | AuthError::TokenRefreshFailed(_)
        | AuthError::NoAuthorizationSupport => {
            tracing::warn!(error = ?error, %slug, "an MCP grant needs reconnecting");
            EgressError::NeedsReauthorization(slug.clone())
        }
        other => EgressError::Upstream(rootcause::report!(
            "MCP server {slug} would not authorize us: {other}"
        )),
    }
}
