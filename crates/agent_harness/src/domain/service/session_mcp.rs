//! Keeping a live session's MCP servers in step with what its owner has
//! connected: an app connected in settings mid-session reaches the agent on
//! its next prompt, without a new session.

use super::*;
use crate::domain::model::SandboxEgress;

impl<
    Sessions,
    Containers,
    Announcer,
    Runtimes,
    PromptContext,
    PromptComposer,
    Egress,
    Lifecycle,
    Mentions,
    Notifier,
>
    AgentHarnessInner<
        Sessions,
        Containers,
        Announcer,
        Runtimes,
        PromptContext,
        PromptComposer,
        Egress,
        Lifecycle,
        Mentions,
        Notifier,
    >
where
    Sessions: AgentSessionService,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
    Runtimes: RuntimeConnections,
    PromptContext: MessagePromptContext,
    PromptComposer: AgentPromptComposer,
    Egress: SandboxEgressProvisioner,
    Lifecycle: AgentSessionLifecyclePublisher,
    Mentions: PromptMentions,
    Notifier: AgentSessionNotifier,
{
    /// Hand the session's live agent its server list as it stands now, if
    /// that differs from what it was handed.
    ///
    /// Called before a prompt is delivered, so the prompt runs with whatever
    /// the owner connected since the session attached. The list is rebuilt
    /// around the session's existing token, under the session's own app
    /// selection - the same listing a reattach does. A session not attached
    /// here needs nothing: delivery attaches it with a fresh list.
    ///
    /// A failure leaves the agent on the servers it has and the prompt goes
    /// out regardless; the next prompt tries again.
    pub(super) async fn refresh_mcp_servers(&self, session_id: AgentSessionId) {
        if let Err(error) = self.try_refresh_mcp_servers(session_id).await {
            tracing::warn!(
                error = ?error,
                %session_id,
                "could not refresh a session's MCP servers; the prompt runs with the ones it has"
            );
        }
    }

    async fn try_refresh_mcp_servers(&self, session_id: AgentSessionId) -> Result<()> {
        let Some(attached) = self.sessions.attached_mcp_servers(session_id) else {
            return Ok(());
        };
        let session = self.sessions.get_session(session_id).await?;
        if !AgentKind::for_session(session.bot_id, &session.harness).takes_egress_mcp_servers() {
            return Ok(());
        }
        let Some(token) = SandboxEgress::session_token_in(&attached) else {
            return Ok(());
        };
        let current = self
            .egress
            .restore(session.owner_user()?, token, &session.mcp_servers)
            .await?
            .acp_servers();
        if current == attached {
            return Ok(());
        }
        tracing::info!(
            %session_id,
            servers = current.len(),
            "handing a live session its owner's current MCP servers"
        );
        self.sessions
            .replace_mcp_servers(session_id, current)
            .await?;
        Ok(())
    }
}
