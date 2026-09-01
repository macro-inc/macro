//! Resolving a slug to one of the owner's Pipedream-connected apps.
//!
//! There is no OAuth here to manage. Pipedream owns every user grant - the
//! consent flow, the stored tokens, the refresh - and its remote MCP server
//! injects the account's credentials server-side. What a request needs from
//! us is our own project-level API token and the `x-pd-*` headers that say
//! which user and app to act as, and *that* pair is exactly why this traffic
//! must flow through the proxy: the bearer is project-wide, so whoever holds
//! it picks the user. The sandbox never does; the user id is stamped from the
//! session's grant.
//!
//! Both halves come from `pipedream_mcp`'s own ports - the same rows the chat
//! tool path reads, the same client that dials Pipedream for it - so an app
//! connected in Macro is an app the sandbox can reach, with nothing to keep
//! in sync.

use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::models::PipedreamConnection;
use pipedream_mcp::domain::ports::ConnectionStore;
use pipedream_mcp::outbound::api::McpUpstream;
use std::sync::Arc;

use crate::domain::error::EgressError;
use crate::domain::model::{BearerToken, McpDestination, McpServerSlug, UpstreamCall};
use crate::domain::ports::McpCredentials;

#[cfg(test)]
mod test;

/// Resolves MCP slugs against an owner's Pipedream connections.
pub struct PipedreamMcpCredentials<Connections, Upstream> {
    connections: Arc<Connections>,
    upstream: Upstream,
}

impl<Connections, Upstream> PipedreamMcpCredentials<Connections, Upstream>
where
    Connections: ConnectionStore,
    Upstream: McpUpstream,
{
    /// Build the adapter over the store holding the owner's connections and
    /// the client that addresses Pipedream's MCP server.
    pub fn new(connections: Arc<Connections>, upstream: Upstream) -> Self {
        Self {
            connections,
            upstream,
        }
    }

    /// The owner's enabled connection whose `app_slug` is exactly `slug`.
    ///
    /// Scoped to the owner by the store call itself, and filtered to `enabled`
    /// here because the store does not: a disabled connector is one the owner
    /// turned off, and turning it off has to take the sandbox's access with it.
    async fn connection(
        &self,
        owner: &MacroUserIdStr<'static>,
        slug: &McpServerSlug,
    ) -> Result<PipedreamConnection, EgressError> {
        self.connections
            .list(owner)
            .await
            .map_err(|error| {
                EgressError::Internal(rootcause::report!(
                    "could not list Pipedream connections: {error:?}"
                ))
            })?
            .into_iter()
            .filter(|record| record.enabled)
            // `app_slug`, not `server_name`: the app slug is Pipedream's
            // stable identifier, and the display name is the user's to
            // rename. The provisioner advertises the same value, and equality
            // is the whole match - nothing is derived at either end.
            .find(|record| record.app_slug == slug.as_str())
            .ok_or_else(|| EgressError::UnknownServer(slug.clone()))
    }
}

impl<Connections, Upstream> McpCredentials for PipedreamMcpCredentials<Connections, Upstream>
where
    Connections: ConnectionStore,
    Upstream: McpUpstream,
{
    #[tracing::instrument(skip_all, err, fields(%owner, ?destination))]
    async fn resolve(
        &self,
        owner: &MacroUserIdStr<'static>,
        destination: &McpDestination,
    ) -> Result<UpstreamCall, EgressError> {
        // Macro's own server is the composition root's to layer on with
        // [`crate::outbound::macro_mcp::WithMacroMcp`]; these rows can never
        // answer for it.
        let McpDestination::Connected(slug) = destination else {
            return Err(EgressError::Internal(rootcause::report!(
                "the Pipedream resolver was asked for Macro's own MCP server; \
                 the composition root did not layer WithMacroMcp"
            )));
        };
        let record = self.connection(owner, slug).await?;

        // A dead grant is Pipedream's to notice, not ours: we hold no
        // refresh token to fail on. If the account behind this connection has
        // gone unhealthy, Pipedream answers the forwarded call with its own
        // error and the status passes through to the agent.
        let call = self.upstream.upstream(&record).await.map_err(|error| {
            EgressError::Upstream(rootcause::report!(
                "could not address Pipedream for {slug}: {error:?}"
            ))
        })?;

        // Typed at the source, but not yet vetted: `UpstreamCall`'s
        // constructor is what refuses a non-https endpoint, and it is the
        // only way to pair this URL with a credential.
        Ok(
            UpstreamCall::bearer(call.url, BearerToken::new(call.bearer_token))?
                .scoped_by(call.headers),
        )
    }
}
