//! In-memory port implementations and recorded fixtures, for tests.

use crate::domain::event::CursorEvent;
use crate::domain::model::{AcpSessionId, CursorAgentId, CursorRunId, McpServer, RepoUrl};
use crate::domain::ports::{CursorAgents, RepoResolver, RunStream, SessionNotifier};
use agent_client_protocol::schema::v1::SessionUpdate;
use futures::Stream;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

/// The recorded-SSE corpus directory.
#[must_use]
pub fn fixtures_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join("real")
}

/// Load a recorded raw-SSE fixture (`fixtures/real/*.sse`) as the bytes
/// Cursor sent, for replay through [`crate::replay`].
///
/// # Panics
/// On an unreadable file — fixtures are part of the test suite, and a broken
/// one should fail loudly.
#[must_use]
pub fn fixture_sse(name: &str) -> String {
    let path = fixtures_dir().join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()))
}

/// Load a recorded fixture already decoded into domain events.
#[must_use]
pub fn fixture_events(name: &str) -> Vec<CursorEvent> {
    crate::replay::events(&fixture_sse(name))
}

/// What a [`FakeCursor`] was asked to do.
#[derive(Debug, Clone, PartialEq)]
pub enum CursorCall {
    /// `create_agent(prompt, repo, mcp_servers)`.
    CreateAgent(String, Option<RepoUrl>, Vec<McpServer>),
    /// `create_run(agent, prompt)`.
    CreateRun(CursorAgentId, String),
    /// `cancel_run(agent, run)`.
    CancelRun(CursorAgentId, CursorRunId),
}

/// A scripted Cursor: hands out ids, records calls, and streams whatever the
/// test pushes into the current run's channel.
#[derive(Debug, Clone, Default)]
pub struct FakeCursor {
    inner: Arc<Mutex<FakeCursorState>>,
}

#[derive(Debug, Default)]
struct FakeCursorState {
    calls: Vec<CursorCall>,
    next_run: u64,
    /// The receiver the next `stream()` call will drain.
    streams: Vec<mpsc::UnboundedReceiver<CursorEvent>>,
}

impl FakeCursor {
    /// A fake with no scripted streams.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Queue a stream for the next run and get its sending half.
    ///
    /// Each `stream()` call consumes one queued stream in order; the test
    /// drives the turn by sending events and dropping the sender to end it.
    pub fn script_stream(&self) -> mpsc::UnboundedSender<CursorEvent> {
        let (sender, receiver) = mpsc::unbounded_channel();
        self.inner
            .lock()
            .expect("fake cursor poisoned")
            .streams
            .push(receiver);
        sender
    }

    /// Everything the service asked of the API, in order.
    #[must_use]
    pub fn calls(&self) -> Vec<CursorCall> {
        self.inner
            .lock()
            .expect("fake cursor poisoned")
            .calls
            .clone()
    }
}

impl CursorAgents for FakeCursor {
    async fn create_agent(
        &self,
        prompt: &str,
        repo: Option<&RepoUrl>,
        mcp_servers: &[McpServer],
    ) -> Result<(CursorAgentId, CursorRunId), rootcause::Report> {
        let mut state = self.inner.lock().expect("fake cursor poisoned");
        state.calls.push(CursorCall::CreateAgent(
            prompt.to_owned(),
            repo.cloned(),
            mcp_servers.to_vec(),
        ));
        state.next_run += 1;
        Ok((
            CursorAgentId::new("bc-fake"),
            CursorRunId::new(format!("run-fake-{}", state.next_run)),
        ))
    }

    async fn create_run(
        &self,
        agent: &CursorAgentId,
        prompt: &str,
    ) -> Result<CursorRunId, rootcause::Report> {
        let mut state = self.inner.lock().expect("fake cursor poisoned");
        state
            .calls
            .push(CursorCall::CreateRun(agent.clone(), prompt.to_owned()));
        state.next_run += 1;
        Ok(CursorRunId::new(format!("run-fake-{}", state.next_run)))
    }

    async fn cancel_run(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> Result<(), rootcause::Report> {
        self.inner
            .lock()
            .expect("fake cursor poisoned")
            .calls
            .push(CursorCall::CancelRun(agent.clone(), run.clone()));
        Ok(())
    }
}

impl RunStream for FakeCursor {
    async fn stream(
        &self,
        _agent: &CursorAgentId,
        _run: &CursorRunId,
    ) -> Result<impl Stream<Item = Result<CursorEvent, rootcause::Report>> + Send, rootcause::Report>
    {
        let receiver = {
            let mut state = self.inner.lock().expect("fake cursor poisoned");
            if state.streams.is_empty() {
                return Err(rootcause::report!("no scripted stream queued"));
            }
            state.streams.remove(0)
        };
        Ok(futures::stream::unfold(receiver, |mut receiver| async {
            receiver.recv().await.map(|event| (Ok(event), receiver))
        }))
    }
}

/// Records every update it is asked to deliver.
#[derive(Debug, Clone, Default)]
pub struct RecordingNotifier {
    updates: Arc<Mutex<Vec<(AcpSessionId, SessionUpdate)>>>,
}

impl RecordingNotifier {
    /// A notifier with nothing recorded.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Everything delivered so far, in order.
    #[must_use]
    pub fn updates(&self) -> Vec<(AcpSessionId, SessionUpdate)> {
        self.updates.lock().expect("notifier poisoned").clone()
    }
}

impl SessionNotifier for RecordingNotifier {
    async fn notify(
        &self,
        session: &AcpSessionId,
        update: SessionUpdate,
    ) -> Result<(), rootcause::Report> {
        self.updates
            .lock()
            .expect("notifier poisoned")
            .push((session.clone(), update));
        Ok(())
    }
}

/// Resolves every session to the same repository — or none.
#[derive(Debug, Clone, Default)]
pub struct FixedRepos(pub Option<RepoUrl>);

impl RepoResolver for FixedRepos {
    fn resolve(&self, _cwd: &Path) -> Option<RepoUrl> {
        self.0.clone()
    }
}
