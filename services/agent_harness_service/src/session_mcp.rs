//! Adapt the native runtime's advertised credential to the harness refresh use case.
use agent_client_protocol::schema::v1::McpServer;
use agent_egress::domain::model::SessionToken;
use agent_harness::domain::ports::SandboxEgressProvisioner;
use agent_inmem::domain::mcp::SessionMcpSource;
use agent_session::domain::{model::AgentSessionId, ports::AgentSessionRepo};
use std::{pin::Pin, sync::Arc};

pub struct SessionConnectors<R, P> {
    pub sessions: R,
    pub provisioner: Arc<P>,
}

impl<R: AgentSessionRepo, P: SandboxEgressProvisioner> SessionMcpSource
    for SessionConnectors<R, P>
{
    fn servers<'a>(
        &'a self,
        session: AgentSessionId,
        advertised: Vec<McpServer>,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<Vec<McpServer>>> + Send + 'a>> {
        Box::pin(async move {
            let token = advertised
                .iter()
                .find_map(|server| match server {
                    McpServer::Http(server)
                        if server.name == agent_inmem::domain::mcp::MACRO_MCP_NAME =>
                    {
                        server
                            .headers
                            .iter()
                            .find(|header| header.name.eq_ignore_ascii_case("authorization"))
                            .and_then(|header| header.value.strip_prefix("Bearer "))
                    }
                    _ => None,
                })
                .ok_or_else(|| anyhow::anyhow!("Session MCP credential is missing"))?;
            let egress = agent_harness::domain::service::session_mcp::refresh(
                &self.sessions,
                self.provisioner.as_ref(),
                session,
                SessionToken::new(token.to_owned()),
            )
            .await?;
            Ok(egress.acp_servers())
        })
    }
}
