//! Handing a sandbox its one secret, and telling opencode where to spend it.
//!
//! Two adapter concerns the domain has no business with: minting a token, and
//! listing the owner's Pipedream-connected apps, which needs their rows.
//!
//! Both the minting and the hashing are `agent_egress`'s, not a second
//! implementation of either. The two ends of this token are written in
//! different crates and read months apart, and a hash computed differently at
//! each end reads at runtime as "every request from every sandbox is
//! unauthenticated".

use agent_egress::domain::model::{McpServerSlug, SessionToken};
use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::ports::ConnectionStore;
use std::sync::Arc;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{ProvisionedEgress, SandboxEgress};
use crate::domain::ports::SandboxEgressProvisioner;
use agent_session::domain::model::{AgentMcpServers, AgentSessionId};

#[cfg(test)]
mod test;

/// Mints session tokens and gathers the MCP servers a sandbox may dial.
pub struct EgressProvisioner<Connections> {
    connections: Arc<Connections>,
    base_url: String,
}

impl<Connections> EgressProvisioner<Connections>
where
    Connections: ConnectionStore,
{
    /// Build the provisioner over the Pipedream connection store and the
    /// egress proxy's public address.
    pub fn new(connections: Arc<Connections>, base_url: impl Into<String>) -> Self {
        Self {
            connections,
            base_url: base_url.into().trim_end_matches('/').to_owned(),
        }
    }

    /// The slugs to advertise for one session, verbatim.
    ///
    /// `app_slug`, exactly as the proxy resolves it - the same value at both
    /// ends by equality is what makes a server entry dialable, and there is
    /// no derivation for the two to disagree over. Macro's own server is not
    /// in the list: every session has it, on its own route.
    ///
    /// Under [`AgentMcpServers::OwnerConnections`] an app the owner turned
    /// off is left out here as well as refused by the proxy: an agent that
    /// can see a server in its list will try it, and a call the proxy answers
    /// with a bare "no such server" is worse than a tool that is absent.
    ///
    /// Under [`AgentMcpServers::Selected`] the agent's list is advertised
    /// whole, including apps the owner has not connected. That is deliberate,
    /// and the reason the proxy answers those differently: a call to a
    /// selected-but-unconnected app comes back as a tool result that says so
    /// and names the fix, which the model can act on, and the moment the
    /// owner connects the app the same advertised server starts working with
    /// nothing re-attached.
    async fn advertised(
        &self,
        owner: &MacroUserIdStr<'static>,
        selection: &AgentMcpServers,
    ) -> Result<Vec<McpServerSlug>> {
        let raw: Vec<String> = match selection {
            AgentMcpServers::OwnerConnections => self
                .connections
                .list(owner)
                .await
                .map_err(|error| {
                    HarnessError::Egress(rootcause::report!(
                        "could not list Pipedream connections: {error:?}"
                    ))
                })?
                .into_iter()
                .filter(|record| record.enabled)
                .map(|record| record.app_slug)
                .collect(),
            AgentMcpServers::Selected { servers } => servers
                .iter()
                .map(|server| server.app_slug.clone())
                .collect(),
        };

        let slugs: Vec<McpServerSlug> = raw
            .into_iter()
            .filter_map(|app_slug| {
                let slug = McpServerSlug::parse(&app_slug);
                if slug.is_none() {
                    // An app slug the strict parse refuses could never be
                    // dialed - the proxy would refuse the same path segment -
                    // so leaving it out is the only honest rendering.
                    tracing::warn!(
                        %owner,
                        %app_slug,
                        "an MCP server's app slug is not a valid path segment; skipped"
                    );
                }
                slug
            })
            .collect();
        tracing::debug!(
            mcp_servers = slugs.len(),
            scope = selection.scope_str(),
            "advertising MCP servers"
        );
        Ok(slugs)
    }
}

impl<Connections> SandboxEgressProvisioner for EgressProvisioner<Connections>
where
    Connections: ConnectionStore,
{
    #[tracing::instrument(err, skip(self), fields(%session, %owner))]
    async fn provision(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        selection: &AgentMcpServers,
    ) -> Result<ProvisionedEgress> {
        let token = SessionToken::mint();

        Ok(ProvisionedEgress {
            session_token_hash: token.hash(),
            sandbox: SandboxEgress {
                base_url: self.base_url.clone(),
                session_token: token.as_str().to_owned(),
                mcp_servers: self.advertised(owner, selection).await?,
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
        Ok(SandboxEgress {
            base_url: self.base_url.clone(),
            session_token,
            mcp_servers: self.advertised(owner, selection).await?,
        })
    }
}
