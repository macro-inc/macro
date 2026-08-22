//! Hands out Cursor cloud agents as session "containers".
//!
//! "Container" is the port's word, not reality's: there is no sandbox here.
//! Spawning wires an in-process ACP agent (`cursor_cloud_agents::serve`) to a
//! [`PipeTransport`] over a `tokio::io::duplex`, and the actual work happens
//! on a Cursor cloud agent in Cursor's VMs. That is why the lifecycle is so
//! much smaller than Daytona's — no image, no readiness recipe, no idle
//! reaper (an idle cloud agent costs us nothing), and teardown archives the
//! agent on cursor.com rather than destroying anything.
//!
//! What does need managing is the mapping. Cursor's API has no labels, so
//! `AgentSessionId -> cursor agent` lives only in the external-session repo:
//! written the moment an agent is minted (by [`RecordingCursor`], before the
//! create call returns), read back by `resume` to pre-seed the served session
//! with `restore_session`, and deleted on teardown.

use std::path::Path;
use std::sync::Arc;

use agent_session::domain::model::{AgentSessionId, ExternalSession};
use agent_session::domain::ports::{AgentSessionRepo, ExternalSessionRepo};
use cursor_cloud_agents::api::CursorClient;
use cursor_cloud_agents::domain::model::RepoUrl as CursorRepoUrl;
use cursor_cloud_agents::domain::model::{AcpSessionId, CursorAgentId, CursorRunId, McpServer};
use cursor_cloud_agents::domain::ports::{CursorAgents, RepoResolver, RunStream};
use cursor_cloud_agents::domain::service::CursorSessionService;
use cursor_cloud_agents::inbound::acp::{AcpNotifier, AcpWriter, serve};
use futures::Stream;

use super::pipe::PipeTransport;
use crate::domain::error::{HarnessError, Result};
use crate::domain::model::SpawnContainer;
use crate::domain::ports::ContainerManager;

#[cfg(test)]
mod test;

/// The provider name stored on external-session rows this manager writes.
pub const CURSOR_PROVIDER: &str = "cursor";

/// Byte capacity of each session's in-process ACP pipe. Frames are single
/// JSON lines; this only bounds how far one side can run ahead of the other.
const PIPE_CAPACITY: usize = 64 * 1024;

/// Every session this deployment opens works on the one configured
/// repository, resolved without looking at the workspace path — the path
/// names a directory inside a sandbox that does not exist here.
#[derive(Clone, Debug)]
struct FixedRepo(CursorRepoUrl);

impl RepoResolver for FixedRepo {
    fn resolve(&self, _cwd: &Path) -> Option<CursorRepoUrl> {
        Some(self.0.clone())
    }
}

/// Hands out Cursor cloud agents.
#[derive(Clone)]
pub struct CursorContainerManager<Sessions> {
    client: CursorClient,
    repo: CursorRepoUrl,
    sessions: Sessions,
}

impl<Sessions> CursorContainerManager<Sessions>
where
    Sessions: AgentSessionRepo + ExternalSessionRepo + Clone,
{
    /// Build the manager over a configured client and the repository every
    /// session works on.
    pub fn new(client: CursorClient, repo: CursorRepoUrl, sessions: Sessions) -> Self {
        Self {
            client,
            repo,
            sessions,
        }
    }

    /// Wire up one session's in-process agent and return our end of its pipe.
    ///
    /// `restore` carries the identity a resumed session gets back; a fresh
    /// spawn passes `None` and the first prompt mints a new Cursor agent.
    fn serve_session(
        &self,
        session_id: AgentSessionId,
        restore: Option<(AcpSessionId, CursorAgentId)>,
    ) -> PipeTransport {
        let (ours, theirs) = tokio::io::duplex(PIPE_CAPACITY);
        let (agent_reader, agent_writer) = tokio::io::split(theirs);
        let (writer, run_writer) = AcpWriter::new(agent_writer);
        let cursor = RecordingCursor {
            client: self.client.clone(),
            session_id,
            sessions: self.sessions.clone(),
        };
        let service = Arc::new(CursorSessionService::new(
            cursor,
            AcpNotifier::new(writer.clone()),
            FixedRepo(self.repo.clone()),
        ));
        if let Some((acp_session, agent)) = restore {
            service.restore_session(acp_session, agent, Some(self.repo.clone()), Vec::new());
        }
        tokio::spawn(run_writer);
        tokio::spawn(serve(service, agent_reader, writer));
        PipeTransport::connect(ours)
    }
}

impl<Sessions> ContainerManager for CursorContainerManager<Sessions>
where
    Sessions: AgentSessionRepo + ExternalSessionRepo + Clone,
{
    type Transport = PipeTransport;

    async fn spawn(&self, command: SpawnContainer) -> Result<PipeTransport> {
        Ok(self.serve_session(command.session_id, None))
    }

    async fn resume(&self, session: AgentSessionId) -> Result<PipeTransport> {
        // Both halves of the identity live in Postgres: the ACP session id
        // the harness will name in `session/load`, and the Cursor agent the
        // conversation accumulated on. Missing either means the session never
        // got far enough to matter — serve it fresh and let the next prompt
        // mint a new agent, which is also what `spawn` would do.
        let external = ExternalSessionRepo::get(&self.sessions, session).await?;
        let acp_session_id = AgentSessionRepo::get(&self.sessions, session)
            .await?
            .acp_session_id;
        let restore = external.zip(acp_session_id).map(|(external, acp)| {
            (
                AcpSessionId::new(acp.0.as_ref()),
                CursorAgentId::new(external.external_id),
            )
        });
        Ok(self.serve_session(session, restore))
    }

    async fn teardown(&self, session: AgentSessionId) -> Result<()> {
        // Archive, never delete: the agent and its work belong to the Cursor
        // account's owner, and archiving is reversible on cursor.com while
        // deletion is not. A session with no external row never minted an
        // agent, which is already the state teardown asks for.
        let Some(external) = ExternalSessionRepo::get(&self.sessions, session).await? else {
            return Ok(());
        };
        self.client
            .archive_agent(&CursorAgentId::new(external.external_id))
            .await
            .map_err(|error| HarnessError::Container(error.to_string()))?;
        ExternalSessionRepo::delete(&self.sessions, session).await?;
        Ok(())
    }
}

/// A [`CursorAgents`] decorator that records each minted agent's identity.
///
/// The agent is created inside the served session's first prompt, long after
/// `spawn` returned, so the manager cannot write the mapping itself. This
/// wrapper does it at the only moment the fact exists: after `create_agent`
/// succeeds and before it returns, so no prompt can be answered by an agent
/// the database does not know about. The name and url are fetched with a
/// follow-up `get_agent` — one extra call per session lifetime — and are
/// cosmetic: if the fetch fails the row is still written with the id alone.
struct RecordingCursor<Sessions> {
    client: CursorClient,
    session_id: AgentSessionId,
    sessions: Sessions,
}

impl<Sessions> CursorAgents for RecordingCursor<Sessions>
where
    Sessions: ExternalSessionRepo + Clone,
{
    async fn create_agent(
        &self,
        prompt: &str,
        repo: Option<&CursorRepoUrl>,
        mcp_servers: &[McpServer],
    ) -> std::result::Result<(CursorAgentId, CursorRunId), rootcause::Report> {
        let (agent, run) = self.client.create_agent(prompt, repo, mcp_servers).await?;
        let summary = self
            .client
            .get_agent(&agent)
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, %agent, "could not fetch the new agent's name and url");
            })
            .ok();
        self.sessions
            .upsert(
                self.session_id,
                ExternalSession {
                    provider: CURSOR_PROVIDER.to_owned(),
                    external_id: agent.to_string(),
                    external_name: summary.as_ref().map(|summary| summary.name.clone()),
                    external_url: summary.map(|summary| summary.url),
                },
            )
            .await
            .map_err(|error| rootcause::report!("could not record the cursor agent: {error}"))?;
        Ok((agent, run))
    }

    async fn create_run(
        &self,
        agent: &CursorAgentId,
        prompt: &str,
    ) -> std::result::Result<CursorRunId, rootcause::Report> {
        self.client.create_run(agent, prompt).await
    }

    async fn cancel_run(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> std::result::Result<(), rootcause::Report> {
        self.client.cancel_run(agent, run).await
    }

    async fn run_result(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> std::result::Result<cursor_cloud_agents::domain::model::RunOutcome, rootcause::Report>
    {
        self.client.run_result(agent, run).await
    }
}

impl<Sessions> RunStream for RecordingCursor<Sessions>
where
    Sessions: ExternalSessionRepo + Clone,
{
    async fn stream(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> std::result::Result<
        impl Stream<
            Item = std::result::Result<
                cursor_cloud_agents::domain::event::CursorEvent,
                rootcause::Report,
            >,
        > + Send,
        rootcause::Report,
    > {
        self.client.stream(agent, run).await
    }
}
