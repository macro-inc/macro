//! Handing a sandbox its one secret, and telling opencode where to spend it.
//!
//! Two adapter concerns the domain has no business with: minting a token,
//! and listing what the session's agent may reach, which the connectors
//! service decides.
//!
//! Both the minting and the hashing are `agent_egress`'s, not a second
//! implementation of either. The two ends of this token are written in
//! different crates and read months apart, and a hash computed differently at
//! each end reads at runtime as "every request from every sandbox is
//! unauthenticated".

use agent_egress::domain::model::{
    CustomMcpServerKey, CustomMcpServerListing, McpServerSlug, SessionToken, agent_selection,
};
use connectors::{ConnectorKey, McpConnectionsService};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{ProvisionedEgress, SandboxEgress};
use crate::domain::ports::SandboxEgressProvisioner;
use agent_session::domain::model::{AgentMcpServers, AgentSessionId};

#[cfg(test)]
mod test;

/// Mints session tokens and lists the MCP servers a sandbox may dial.
pub struct EgressProvisioner<Connections> {
    connections: Arc<Connections>,
    base_url: String,
    external_base_url: Option<String>,
}

impl<Connections> EgressProvisioner<Connections>
where
    Connections: McpConnectionsService,
{
    /// Build the provisioner over the connectors service and the egress
    /// proxy's public address.
    pub fn new(connections: Arc<Connections>, base_url: impl Into<String>) -> Self {
        Self {
            connections,
            base_url: base_url.into().trim_end_matches('/').to_owned(),
            external_base_url: None,
        }
    }

    /// Override only the address advertised to external runtimes, such as host macrod in a local stack.
    pub fn with_external_base_url(mut self, url: Option<String>) -> Self {
        self.external_base_url = url.map(|url| url.trim_end_matches('/').to_owned());
        self
    }

    /// The apps and custom servers a session with `selection` is given: the
    /// agent author's apps, connected or not, so a call to one the owner has
    /// not connected asks them to connect it; or, for an agent given
    /// everything, every connection the owner can use. Code executions read
    /// this too, so a program reaches exactly the apps its agent was given.
    /// The egress proxy enforces the same selection on every request.
    pub async fn advertised_all(
        &self,
        owner: &MacroUserIdStr<'static>,
        selection: &AgentMcpServers,
    ) -> Result<(Vec<McpServerSlug>, Vec<CustomMcpServerListing>)> {
        let connections = self
            .connections
            .connections(owner)
            .await
            .map_err(|error| {
                HarnessError::Egress(rootcause::report!(
                    "could not list the owner's MCP connections: {error}"
                ))
            })?
            .scoped(&agent_selection(selection));

        let mut slugs = Vec::new();
        let mut custom = Vec::new();
        for key in connections.destinations() {
            match &key {
                ConnectorKey::App(app) => slugs.extend(McpServerSlug::parse(app.as_str())),
                ConnectorKey::Server(url) => custom.push(CustomMcpServerListing {
                    key: CustomMcpServerKey::for_url(url.as_str()),
                    name: connections
                        .handles()
                        .find(|handle| *handle.key() == key)
                        .map_or_else(|| url.to_string(), |handle| handle.name().to_owned()),
                }),
            }
        }

        Ok((slugs, custom))
    }
}

impl<Connections> SandboxEgressProvisioner for EgressProvisioner<Connections>
where
    Connections: McpConnectionsService,
{
    fn external_mcp_servers(
        &self,
        egress: &SandboxEgress,
    ) -> Vec<agent_client_protocol::schema::v1::McpServer> {
        let mut external = egress.clone();
        if let Some(url) = &self.external_base_url {
            external.base_url = url.clone();
        }
        external.acp_servers()
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
