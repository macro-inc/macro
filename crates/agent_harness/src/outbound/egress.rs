//! Handing a sandbox its one secret, and telling opencode where to spend it.
//!
//! Three adapter concerns the domain has no business with: minting a token,
//! listing the owner's Pipedream-connected apps, and listing the owner's own
//! custom MCP servers - the last two need their rows.
//!
//! Both the minting and the hashing are `agent_egress`'s, not a second
//! implementation of either. The two ends of this token are written in
//! different crates and read months apart, and a hash computed differently at
//! each end reads at runtime as "every request from every sandbox is
//! unauthenticated".

use agent_egress::domain::model::{
    CustomMcpServerKey, CustomMcpServerListing, McpServerSlug, SessionToken,
};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::ports::McpServerStore;
use pipedream_mcp::domain::ports::ConnectionStore;
use std::sync::Arc;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{ProvisionedEgress, SandboxEgress};
use crate::domain::ports::SandboxEgressProvisioner;
use agent_session::domain::model::{AgentMcpServers, AgentSessionId};

#[cfg(test)]
mod test;

/// Mints session tokens and gathers the MCP servers a sandbox may dial.
pub struct EgressProvisioner<Connections, Servers> {
    connections: Arc<Connections>,
    custom_servers: Arc<Servers>,
    base_url: String,
    external_base_url: Option<String>,
}

impl<Connections, Servers> EgressProvisioner<Connections, Servers>
where
    Connections: ConnectionStore,
    Servers: McpServerStore,
{
    /// Build the provisioner over the Pipedream connection store, the custom
    /// MCP server store, and the egress proxy's public address.
    pub fn new(
        connections: Arc<Connections>,
        custom_servers: Arc<Servers>,
        base_url: impl Into<String>,
    ) -> Self {
        Self {
            connections,
            custom_servers,
            base_url: base_url.into().trim_end_matches('/').to_owned(),
            external_base_url: None,
        }
    }

    /// Override only the address advertised to external runtimes, such as host macrod in a local stack.
    pub fn with_external_base_url(mut self, url: Option<String>) -> Self {
        self.external_base_url = url.map(|url| url.trim_end_matches('/').to_owned());
        self
    }

    // Both runtime hosts use mcp_select's provider policy. This adapter only
    // loads owner-scoped rows and converts the result to proxy addresses.
    async fn advertised_all(
        &self,
        owner: &MacroUserIdStr<'static>,
        selection: &AgentMcpServers,
    ) -> Result<(Vec<McpServerSlug>, Vec<CustomMcpServerListing>)> {
        // Selected-agent permissions are unchanged: advertise the author's
        // explicit list and never add the owner's private servers to it.
        if let AgentMcpServers::Selected { servers } = selection {
            return Ok((
                servers
                    .iter()
                    .filter_map(|server| McpServerSlug::parse(&server.app_slug))
                    .collect(),
                Vec::new(),
            ));
        }
        let native = self.custom_servers.list(owner).await.map_err(|error| {
            HarnessError::Egress(rootcause::report!(
                "could not list custom MCP servers: {error:?}"
            ))
        })?;
        let pipedream = self.connections.list(owner).await.map_err(|error| {
            HarnessError::Egress(rootcause::report!(
                "could not list Pipedream connections: {error:?}"
            ))
        })?;
        let (native, pipedream) = mcp_select::select_connections(native, pipedream);
        Ok((
            pipedream
                .into_iter()
                .filter_map(|r| McpServerSlug::parse(&r.app_slug))
                .collect(),
            native
                .into_iter()
                .map(|r| CustomMcpServerListing {
                    key: CustomMcpServerKey::for_url(&r.url),
                    name: r.server_name,
                })
                .collect(),
        ))
    }
}

impl<Connections, Servers> SandboxEgressProvisioner for EgressProvisioner<Connections, Servers>
where
    Connections: ConnectionStore,
    Servers: McpServerStore,
{
    fn external_mcp_servers(
        &self,
        egress: &SandboxEgress,
    ) -> Vec<agent_client_protocol::schema::v1::McpServer> {
        let mut external = egress.clone();
        if let Some(url) = &self.external_base_url {
            external.base_url = url.clone();
        }
        vec![
            external.internal_mcp_server(),
            external.preview_mcp_server(),
        ]
    }

    #[tracing::instrument(err, skip(self), fields(%session, %owner))]
    async fn provision(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        selection: &AgentMcpServers,
    ) -> Result<ProvisionedEgress> {
        let token = SessionToken::mint();
        let (mcp_servers, custom_servers) = self.advertised_all(owner, selection).await?;

        Ok(ProvisionedEgress {
            session_token_hash: token.hash(),
            sandbox: SandboxEgress {
                base_url: self.base_url.clone(),
                session_token: token.as_str().to_owned(),
                mcp_servers,
                custom_servers,
            },
        })
    }

    #[tracing::instrument(err, skip(self, session_token), fields(%owner))]
    async fn restore(
        &self,
        owner: &MacroUserIdStr<'static>,
        session_token: String,
        selection: &AgentMcpServers,
    ) -> Result<SandboxEgress> {
        let (mcp_servers, custom_servers) = self.advertised_all(owner, selection).await?;
        Ok(SandboxEgress {
            base_url: self.base_url.clone(),
            session_token,
            mcp_servers,
            custom_servers,
        })
    }
}
