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
//!
//! There is no deployment-wide Cursor client here, because there is no
//! deployment-wide Cursor key: a session runs on *its owner's* account, so
//! every entry point resolves the owner's key and mints a client for that one
//! session. The manager holds only what a client is built from.

use std::path::Path;
use std::sync::Arc;

use agent_client_protocol::schema::v1::SessionId;
use agent_session::domain::model::{AgentSession, AgentSessionId, ExternalSession};
use agent_session::domain::ports::{AgentSessionRepo, ExternalSessionRepo};
use cursor_cloud_agents::api::{ApiKey, CursorClient, CursorConfig};
use cursor_cloud_agents::domain::model::RepoUrl as CursorRepoUrl;
use cursor_cloud_agents::domain::model::{
    CursorAgentId, CursorModel, CursorRunId, McpServer, ModelChoice,
};
use cursor_cloud_agents::domain::ports::{CursorAgents, RepoResolver, RunStream};
use cursor_cloud_agents::domain::service::CursorSessionService;
use cursor_cloud_agents::inbound::acp::{AcpNotifier, serve};
use futures::Stream;

use super::keys::CursorApiKeys;
use super::pipe::PipeTransport;
use crate::domain::error::{HarnessError, Result};
use crate::domain::model::SpawnContainer;
use crate::domain::ports::ContainerManager;
use crate::domain::sandbox::SandboxResizeEffect;
use agent_session::domain::model::SandboxSize;

#[cfg(test)]
mod test;

/// The provider name stored on external-session rows this manager writes.
pub const CURSOR_PROVIDER: &str = "cursor";

/// Byte capacity of each session's in-process ACP pipe. Frames are single
/// JSON lines; this only bounds how far one side can run ahead of the other.
const PIPE_CAPACITY: usize = 64 * 1024;

/// How often a live session checks for cursor.com activity on its agent.
///
/// The agent's page on cursor.com drives the same conversation, and Cursor's
/// v1 API has no webhooks yet — so while a session's transport is up, its
/// service polls, and a turn driven over there mirrors into Macro within
/// about a second instead of waiting for the next Macro prompt. One
/// `list_runs` per second per live session; a session mid-turn skips its
/// tick, and the poll dies with the pipe.
///
/// A fixed rate rather than a delay between polls: `list_runs` is a network
/// call, so sleeping this long *after* each one would quietly make the real
/// period `1s + latency` — the mirror falling furthest behind exactly when
/// Cursor is slowest.
const FOREIGN_SYNC_INTERVAL: std::time::Duration = std::time::Duration::from_secs(1);

/// A pipe idle this long is shut down, Daytona's reaper made local: the
/// session actor sees a clean disconnect and the next prompt resumes through
/// [`ContainerManager::resume`]. What this reclaims is not a sandbox — there
/// is none — but the pipe's tasks and its per-second cursor.com poll.
const CURSOR_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5 * 60);

/// How often the idle timeout is evaluated.
///
/// Separate from [`FOREIGN_SYNC_INTERVAL`] because the two answer different
/// questions: the mirror's rate is how stale a cursor.com turn may look, this
/// is how late a pipe may be reclaimed. Checking a five-minute deadline once
/// a second would spend three hundred wakeups to fire once, and would tie the
/// reaper's precision to a poll rate chosen for something else. The cost of a
/// coarse check is that a pipe lives up to this long past its deadline, which
/// for reclaiming two idle tasks is nothing.
const CURSOR_IDLE_CHECK_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);

/// The ref new agents start their work from.
const DEFAULT_STARTING_REF: &str = "main";

/// A ticker of period `every`, first firing one period from now.
///
/// Two deliberate choices `tokio::time::interval` would not have made. It
/// fires its first tick immediately, which here would poll cursor.com the
/// instant a pipe opens — before the first prompt, on a session that has no
/// agent to ask about yet. And it defaults to [`MissedTickBehavior::Burst`],
/// which after one slow poll fires the whole backlog back to back at Cursor's
/// API; [`MissedTickBehavior::Delay`] just resumes the cadence from the tick
/// that ran late.
fn interval_from_now(every: std::time::Duration) -> tokio::time::Interval {
    let mut ticker = tokio::time::interval_at(tokio::time::Instant::now() + every, every);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    ticker
}

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
pub struct CursorContainerManager<Sessions, Keys> {
    keys: Keys,
    base_url: String,
    repo: CursorRepoUrl,
    sessions: Sessions,
}

/// What a resumed session gets back at restore time.
///
/// The identity halves land in Postgres at different moments — the ACP session
/// id when `session/new` answers, the Cursor agent when the first prompt mints
/// it — so each is optional on its own; see [`CursorContainerManager::resume`].
struct RestoredCursorSession {
    /// The ACP session id the harness will name in `session/load`.
    acp_session: SessionId,
    /// The Cursor agent, when one was ever minted.
    agent: Option<CursorAgentId>,
    /// The model id the session last reported, from the projected column.
    model_id: Option<String>,
}

impl<Sessions, Keys> CursorContainerManager<Sessions, Keys>
where
    Sessions: AgentSessionRepo + ExternalSessionRepo + Clone,
    Keys: CursorApiKeys,
{
    /// Build the manager over the key source, the API it talks to, and the
    /// repository every session works on.
    pub fn new(keys: Keys, base_url: String, repo: CursorRepoUrl, sessions: Sessions) -> Self {
        Self {
            keys,
            base_url,
            repo,
            sessions,
        }
    }

    /// A client authenticated as `session`'s owner.
    ///
    /// Built per session and dropped with it, rather than held on the manager:
    /// the key belongs to one user, and the sessions of two users must not be
    /// able to reach each other's Cursor accounts through a shared client.
    async fn client_for(&self, session: &AgentSession) -> Result<(CursorClient, Option<String>)> {
        let config = self.keys.resolve(&session.owner_id).await?;
        let client = CursorClient::new(CursorConfig {
            api_key: ApiKey::new(config.key.expose()),
            base_url: self.base_url.clone(),
            // The client-level model stays absent: the *session* carries the
            // model now (the user's default, seeded below via
            // `with_default_model`, or a per-session pick), applied per run.
            model: None,
            starting_ref: DEFAULT_STARTING_REF.to_owned(),
            record_dir: None,
        })
        .map_err(|error| {
            // The key came out of KMS, so a shape complaint here means a
            // corrupt row rather than a bad paste — the user cannot fix it by
            // retyping, and the fix is to register the key again.
            tracing::error!(error = %error, session_id = %session.id, "a stored cursor api key is unusable");
            HarnessError::Container("the stored cursor api key is unusable".to_owned())
        })?;
        Ok((client, config.default_model_id))
    }

    /// Wire up one session's in-process agent and return our end of its pipe.
    ///
    /// `restore` carries what a resumed session gets back; a fresh spawn
    /// passes `None`.
    fn serve_session(
        &self,
        client: CursorClient,
        default_model_id: Option<String>,
        session_id: AgentSessionId,
        restore: Option<RestoredCursorSession>,
    ) -> PipeTransport {
        let (ours, theirs) = tokio::io::duplex(PIPE_CAPACITY);
        let (agent_reader, agent_writer) = tokio::io::split(theirs);
        let cursor = RecordingCursor {
            client,
            session_id,
            sessions: self.sessions.clone(),
        };
        let notifier = AcpNotifier::new();
        // The user's chosen model seeds the session as its default: a fresh
        // session starts on it, and a resumed one still prefers whatever it
        // was actually last using (carried in `restore.model_id`) over this.
        let service = Arc::new(
            CursorSessionService::new(cursor, notifier.clone(), FixedRepo(self.repo.clone()))
                .with_default_model(default_model_id),
        );
        if let Some(restored) = restore {
            service.restore_session(
                restored.acp_session,
                restored.agent,
                Some(self.repo.clone()),
                restored.model_id,
            );
        }
        let pipe_closed = tokio_util::sync::CancellationToken::new();
        let shutdown = tokio_util::sync::CancellationToken::new();
        let sync_service = Arc::clone(&service);
        let on_pipe_close = pipe_closed.clone();
        tokio::spawn(async move {
            if let Err(error) = serve(service, notifier, agent_reader, agent_writer).await {
                tracing::warn!(%session_id, error = %error, "cursor acp connection ended with an error");
            }
            on_pipe_close.cancel();
        });
        // One task carries the session's two background jobs, on their own
        // cadences: mirroring cursor.com, and retiring a pipe nothing has
        // moved through.
        // tokio's clock, not std's: identical on a running service, and it
        // honours `tokio::time::pause` so both paths are testable without
        // waiting out five real minutes.
        let last_activity = Arc::new(std::sync::Mutex::new(tokio::time::Instant::now()));
        let observed = Arc::clone(&last_activity);
        let reaper_shutdown = shutdown.clone();
        tokio::spawn(async move {
            let mut mirror = interval_from_now(FOREIGN_SYNC_INTERVAL);
            let mut reaper = interval_from_now(CURSOR_IDLE_CHECK_INTERVAL);
            loop {
                tokio::select! {
                    () = pipe_closed.cancelled() => break,
                    _ = reaper.tick() => {
                        let idle = last_activity
                            .lock()
                            .expect("activity clock poisoned")
                            .elapsed();
                        if idle >= CURSOR_IDLE_TIMEOUT {
                            tracing::info!(%session_id, "idle cursor session; closing its pipe");
                            reaper_shutdown.cancel();
                            break;
                        }
                    }
                    _ = mirror.tick() => sync_service.sync_foreign_runs().await,
                }
            }
        });
        PipeTransport::connect_observed(
            ours,
            move || {
                *observed.lock().expect("activity clock poisoned") = tokio::time::Instant::now();
            },
            shutdown,
        )
    }
}

impl<Sessions, Keys> ContainerManager for CursorContainerManager<Sessions, Keys>
where
    Sessions: AgentSessionRepo + ExternalSessionRepo + Clone,
    Keys: CursorApiKeys,
{
    type Transport = PipeTransport;

    async fn spawn(&self, command: SpawnContainer) -> Result<PipeTransport> {
        // The session row is read for its owner alone: spawning is the first
        // moment we can tell whether the person who mentioned @cursor has
        // connected an account, and refusing here is what turns "the bot
        // ignored me" into a sentence they can act on.
        let session = AgentSessionRepo::get(&self.sessions, command.session_id).await?;
        let (client, default_model_id) = self.client_for(&session).await?;
        // No MCP servers pass through here: they ride the ACP protocol
        // itself. The harness's session actor names them in `session/new`,
        // and the in-process adapter forwards them to Cursor's API - the same
        // rail every other transport uses.
        Ok(self.serve_session(client, default_model_id, command.session_id, None))
    }

    async fn resume(&self, session: AgentSessionId) -> Result<PipeTransport> {
        // The identity lives in Postgres in two halves that appear at
        // different moments: the ACP session id lands when `session/new`
        // answers, the Cursor agent only when the first prompt mints it. A
        // session can die between the two, so each half is restored on its
        // own — the harness re-enters with `session/load` whenever it has an
        // acp id, and a load must find its session even when there is no
        // agent yet (the next prompt mints one). No acp id at all means the
        // session never opened; serve it fresh, exactly like `spawn`.
        let stored = AgentSessionRepo::get(&self.sessions, session).await?;
        let (client, default_model_id) = self.client_for(&stored).await?;
        let restore = match &stored.acp_session_id {
            Some(acp) => {
                let agent = ExternalSessionRepo::get(&self.sessions, session)
                    .await?
                    .map(|external| CursorAgentId::new(external.external_id));
                Some(RestoredCursorSession {
                    acp_session: acp.clone(),
                    agent,
                    // The projected model column. It round-trips a picked
                    // model back into the wrapper — and for a session that
                    // never picked, it still holds the deployment slug the
                    // harness seeded it with, which the wrapper resolves to
                    // "no opinion" rather than trusting.
                    model_id: Some(stored.model.clone()),
                })
            }
            None => None,
        };
        // No MCP servers on resume, deliberately. Cursor fixes an agent's MCP
        // config when the agent is created, so a session that prompted before
        // the restart keeps its servers on cursor.com regardless of what is
        // passed here - and the session token needed to mint fresh entries
        // died with the process (only its hash is persisted). The one session
        // this loses servers for is one restored before its first prompt ever
        // landed, which then creates its agent bare rather than not at all.
        Ok(self.serve_session(client, default_model_id, session, restore))
    }

    /// A Cursor session has no container of ours to hold a token: the raw
    /// token went to Cursor's cloud at agent creation and is not readable
    /// back.
    async fn session_token(&self, _session: AgentSessionId) -> Result<Option<String>> {
        Ok(None)
    }

    async fn teardown(&self, session: AgentSessionId) -> Result<()> {
        // Archive, never delete: the agent and its work belong to the Cursor
        // account's owner, and archiving is reversible on cursor.com while
        // deletion is not. A session with no external row never minted an
        // agent, which is already the state teardown asks for.
        let Some(external) = ExternalSessionRepo::get(&self.sessions, session).await? else {
            return Ok(());
        };
        // Archiving needs the owner's key, and teardown is exactly when it may
        // be gone — a user who disconnects Cursor still has sessions to clean
        // up. The row is ours and the agent is theirs, so a key we no longer
        // hold costs them an unarchived agent on cursor.com, which they can
        // see and archive; refusing the teardown instead would leave a Macro
        // session that can never be cleaned up at all.
        let stored = AgentSessionRepo::get(&self.sessions, session).await?;
        let agent = CursorAgentId::new(external.external_id);
        match self.client_for(&stored).await {
            Ok((client, _default_model_id)) => client
                .archive_agent(&agent)
                .await
                .map_err(|error| HarnessError::Container(error.to_string()))?,
            Err(error) => tracing::warn!(
                %session,
                %agent,
                error = %error,
                "tearing down a cursor session without archiving its agent",
            ),
        }
        ExternalSessionRepo::delete(&self.sessions, session).await?;
        Ok(())
    }

    // A Cursor session's compute is Cursor's: there is no sandbox here whose
    // size this manager could change, so every resize is unsupported and the
    // domain persists the preference without touching anything.
    fn resize_effect(&self, _from: SandboxSize, _to: SandboxSize) -> SandboxResizeEffect {
        SandboxResizeEffect::Unsupported
    }

    async fn resize(&self, _session: AgentSessionId, _size: SandboxSize) -> Result<()> {
        Err(HarnessError::Container(
            "a cursor session has no sandbox to resize".to_owned(),
        ))
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
    #[tracing::instrument(skip_all, err, fields(
        session = %self.session_id,
        mcp_servers = mcp_servers.len(),
    ))]
    async fn create_agent(
        &self,
        prompt: &str,
        repo: Option<&CursorRepoUrl>,
        mcp_servers: &[McpServer],
        model: Option<&ModelChoice>,
    ) -> std::result::Result<(CursorAgentId, CursorRunId), rootcause::Report> {
        let (agent, run) = self
            .client
            .create_agent(prompt, repo, mcp_servers, model)
            .await?;
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
        model: Option<&ModelChoice>,
    ) -> std::result::Result<CursorRunId, rootcause::Report> {
        self.client.create_run(agent, prompt, model).await
    }

    async fn list_models(&self) -> std::result::Result<Vec<CursorModel>, rootcause::Report> {
        self.client.list_models().await
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

    async fn list_runs(
        &self,
        agent: &CursorAgentId,
    ) -> std::result::Result<Vec<cursor_cloud_agents::domain::model::RunListing>, rootcause::Report>
    {
        self.client.list_runs(agent).await
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
