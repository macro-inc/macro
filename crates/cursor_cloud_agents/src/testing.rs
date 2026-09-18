//! In-memory port implementations and recorded fixtures, for tests.

use crate::domain::artifact::{ArtifactListing, FetchedArtifact};
use crate::domain::event::CursorEvent;
use crate::domain::journal::NativeRecord;
use crate::domain::model::{
    ConversationLine, CursorAgentId, CursorModel, CursorRunId, McpServer, ModelChoice, RepoUrl,
    RunListing, RunOutcome,
};
use crate::domain::ports::{
    ArtifactStore, ConnectedStream, CursorAgents, CursorArtifacts, RepositoryChooser, RunStream,
    SessionIntent, SessionNotifier, StreamConnectError,
};
use agent_client_protocol::schema::v1::{SessionId, SessionUpdate};
use futures::Stream;
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

/// Load original complete SSE records without decoding their payloads.
#[must_use]
pub fn fixture_records(name: &str) -> Vec<NativeRecord> {
    crate::replay::records(&fixture_sse(name))
}

/// Build a fake provider record using Cursor's HTTP SSE payload shape, not
/// serde's representation of the domain enum. Decoding remains production code.
pub fn raw_record(event: CursorEvent) -> NativeRecord {
    use crate::domain::event::InteractionUpdate;
    use serde_json::json;
    let (event, data) = match event {
        CursorEvent::Status { run_id, status } => (
            "status".to_owned(),
            json!({"runId": run_id, "status": status}),
        ),
        CursorEvent::Assistant { text } => ("assistant".into(), json!({"text": text})),
        CursorEvent::Thinking { text } => ("thinking".into(), json!({"text": text})),
        CursorEvent::ToolCall(call) => (
            "tool_call".into(),
            json!({
                "callId": call.call_id, "name": call.name, "status": call.status,
                "args": call.args, "result": call.result, "truncated": call.truncated,
            }),
        ),
        CursorEvent::Interaction(update) => (
            "interaction_update".into(),
            match update {
                InteractionUpdate::UserMessage { text } => {
                    json!({"type": "user-message-appended", "userMessage": {"text": text}})
                }
                InteractionUpdate::ToolCallStarted { call_id, tool_type } => {
                    json!({"type": "tool-call-started", "callId": call_id, "toolCall": {"type": tool_type}})
                }
                InteractionUpdate::ToolCallCompleted { call_id, tool_type } => {
                    json!({"type": "tool-call-completed", "callId": call_id, "toolCall": {"type": tool_type}})
                }
                InteractionUpdate::TokenDelta { tokens } => {
                    json!({"type": "token-delta", "tokens": tokens})
                }
                InteractionUpdate::Other { kind } => json!({"type": kind}),
            },
        ),
        CursorEvent::Result {
            run_id,
            status,
            text,
            duration_ms,
            git,
        } => (
            "result".into(),
            json!({"runId": run_id, "status": status, "text": text, "durationMs": duration_ms, "git": git}),
        ),
        CursorEvent::Heartbeat => ("heartbeat".into(), json!({})),
        CursorEvent::Error { code, message } => {
            ("error".into(), json!({"code": code, "message": message}))
        }
        CursorEvent::Done => ("done".into(), json!({})),
        CursorEvent::Unknown { event, data } => (event, data),
    };
    NativeRecord {
        event,
        data: data.to_string(),
        id: None,
    }
}

/// Test-side wire encoder. The provider channel carries only native records.
pub struct ScriptSender(mpsc::UnboundedSender<NativeRecord>);

impl ScriptSender {
    /// Whether the provider's stream receiver has been dropped.
    pub fn is_closed(&self) -> bool {
        self.0.is_closed()
    }

    /// Encode a desired event as a Cursor wire record before enqueueing it.
    pub fn send(&self, event: CursorEvent) -> Result<(), mpsc::error::SendError<NativeRecord>> {
        self.0.send(raw_record(event))
    }

    /// Enqueue an already-built native record, ids and all.
    pub fn send_record(
        &self,
        record: NativeRecord,
    ) -> Result<(), mpsc::error::SendError<NativeRecord>> {
        self.0.send(record)
    }

    /// Enqueue an event carrying a provider event id, the way Cursor stamps
    /// the records a resume position can point at.
    pub fn send_with_id(
        &self,
        event: CursorEvent,
        id: &str,
    ) -> Result<(), mpsc::error::SendError<NativeRecord>> {
        self.0.send(NativeRecord {
            id: Some(id.to_owned()),
            ..raw_record(event)
        })
    }
}

/// What a [`FakeCursor`] was asked to do.
#[derive(Debug, Clone, PartialEq)]
pub enum CursorCall {
    /// `create_agent(prompt, repo, open_pull_request, mcp_servers, model)`.
    CreateAgent(
        String,
        Option<RepoUrl>,
        bool,
        Vec<McpServer>,
        Option<ModelChoice>,
    ),
    /// `create_run(agent, prompt, model)`.
    CreateRun(CursorAgentId, String, Option<ModelChoice>),
    /// `cancel_run(agent, run)`.
    CancelRun(CursorAgentId, CursorRunId),
    /// `run_result(agent, run)`.
    RunResult(CursorAgentId, CursorRunId),
    /// `conversation(agent)`.
    Conversation(CursorAgentId),
    /// `list_artifacts(agent)`.
    ListArtifacts(CursorAgentId),
    /// `fetch_artifact(agent, path)`.
    FetchArtifact(CursorAgentId, String),
}

/// A scripted Cursor: hands out ids, records calls, and streams whatever the
/// test pushes into the current run's channel.
#[derive(Debug, Clone, Default)]
pub struct FakeCursor {
    inner: Arc<Mutex<FakeCursorState>>,
    called: Arc<tokio::sync::Notify>,
}

#[derive(Debug, Default)]
struct FakeCursorState {
    calls: Vec<CursorCall>,
    next_run: u64,
    /// What the next `raw_stream()` calls answer with, consumed in order.
    streams: Vec<ScriptedStream>,
    /// The resume position every `raw_stream()` call received, in order.
    resume_positions: Vec<Option<String>>,
    /// The retention window every connected stream reports.
    retention_seconds: Option<u64>,
    /// Answers for `run_result`, consumed in order.
    run_results: Vec<RunOutcome>,
    /// The answer every `list_runs` call gets.
    run_listings: Vec<RunListing>,
    conversation: Vec<ConversationLine>,
    /// Errors the next `create_run` calls answer with, consumed in order.
    create_run_errors: Vec<String>,
    /// Held by the next create call until the test lets it finish.
    create_gate: Option<tokio::sync::oneshot::Receiver<()>>,
    /// The answer every `list_models` call gets.
    models: Vec<CursorModel>,
    model_gate: Option<tokio::sync::oneshot::Receiver<()>>,
    reject_create: bool,
    reject_create_for_repository: bool,
    /// Answers for `list_artifacts`, consumed in order; the last one sticks.
    artifact_listings: Vec<Result<Vec<ArtifactListing>, String>>,
    /// Bodies `fetch_artifact` answers with, by artifact path.
    artifact_bodies: std::collections::HashMap<String, FetchedBody>,
}

/// One scripted artifact download.
#[derive(Debug, Clone)]
struct FetchedBody {
    content_type: Option<String>,
    bytes: Result<bytes::Bytes, String>,
}

impl FakeCursor {
    /// A fake with no scripted streams.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Queue a stream for the next run and get its sending half.
    ///
    /// Each `raw_stream()` call consumes one queued stream in order; the test
    /// drives the turn by sending events and dropping the sender to end it.
    pub fn script_stream(&self) -> ScriptSender {
        ScriptSender(self.script_raw_stream())
    }

    /// Queue original native records, including recorded wire fixtures.
    pub fn script_raw_stream(&self) -> mpsc::UnboundedSender<NativeRecord> {
        self.queue_stream(None)
    }

    /// Queue a stream that dies with `failure` once its sender is dropped —
    /// the mid-run transport break, after whatever records were sent first.
    pub fn script_stream_failing_with(&self, failure: &str) -> ScriptSender {
        ScriptSender(self.queue_stream(Some(failure.to_owned())))
    }

    /// Queue a connect that fails instead of producing a stream.
    pub fn script_stream_connect_error(&self, error: StreamConnectError) {
        self.inner
            .lock()
            .expect("fake cursor poisoned")
            .streams
            .push(ScriptedStream::ConnectError(error));
    }

    /// Report `seconds` as the retention window on every connected stream.
    pub fn script_stream_retention(&self, seconds: u64) {
        self.inner
            .lock()
            .expect("fake cursor poisoned")
            .retention_seconds = Some(seconds);
    }

    /// The resume position each `raw_stream()` call was given, in order.
    #[must_use]
    pub fn resume_positions(&self) -> Vec<Option<String>> {
        self.inner
            .lock()
            .expect("fake cursor poisoned")
            .resume_positions
            .clone()
    }

    fn queue_stream(&self, failure: Option<String>) -> mpsc::UnboundedSender<NativeRecord> {
        let (sender, receiver) = mpsc::unbounded_channel();
        self.inner
            .lock()
            .expect("fake cursor poisoned")
            .streams
            .push(ScriptedStream::Records { receiver, failure });
        sender
    }

    /// Queue the answer the next `run_result` call gets.
    ///
    /// The fallback poll asks repeatedly, so a test scripts the sequence it
    /// wants: a `Running` or two, then the terminal outcome.
    pub fn script_run_result(&self, outcome: RunOutcome) {
        self.inner
            .lock()
            .expect("fake cursor poisoned")
            .run_results
            .push(outcome);
    }

    /// Make the next `count` `create_run` calls fail with `message`.
    pub fn script_create_run_errors(&self, count: usize, message: &str) {
        let mut state = self.inner.lock().expect("fake cursor poisoned");
        for _ in 0..count {
            state.create_run_errors.push(message.to_owned());
        }
    }

    /// Hold the next create call open until the returned sender fires.
    ///
    /// How a test acts inside the window where a turn has started but has no
    /// run id yet — the ten seconds a real first prompt spends creating the
    /// Cursor agent, and the only window in which a stop has nothing to name.
    #[must_use]
    pub fn script_create_gate(&self) -> tokio::sync::oneshot::Sender<()> {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        self.inner.lock().expect("fake cursor poisoned").create_gate = Some(receiver);
        sender
    }

    /// Hold model resolution to inspect pre-execution ordering.
    pub fn script_model_gate(&self) -> tokio::sync::oneshot::Sender<()> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.inner.lock().unwrap().model_gate = Some(rx);
        tx
    }
    /// Reject the next create with a definite provider rejection.
    pub fn script_rejection(&self) {
        self.inner.lock().unwrap().reject_create = true;
    }

    /// Reject the next `create_agent` the way Cursor rejects a repository the
    /// account has never connected.
    pub fn script_repository_rejection(&self) {
        self.inner.lock().unwrap().reject_create_for_repository = true;
    }

    /// Set the models `list_models` answers with.
    pub fn script_models(&self, models: Vec<CursorModel>) {
        self.inner.lock().expect("fake cursor poisoned").models = models;
    }

    /// Set the agent's run history, newest first, for `list_runs`.
    /// What `conversation()` answers with.
    pub fn script_conversation(&self, lines: Vec<ConversationLine>) {
        self.inner
            .lock()
            .expect("fake cursor poisoned")
            .conversation = lines;
    }

    /// Set the agent's run history, newest first, for `list_runs`.
    pub fn script_run_listings(&self, listings: Vec<RunListing>) {
        self.inner
            .lock()
            .expect("fake cursor poisoned")
            .run_listings = listings;
    }

    /// Queue the answer the next `list_artifacts` call gets.
    ///
    /// Calls past the last scripted answer get that answer again, which is
    /// what a real agent-scoped listing does: it keeps returning everything
    /// the agent has ever written.
    pub fn script_artifact_listing(&self, listings: Vec<ArtifactListing>) {
        self.inner
            .lock()
            .expect("fake cursor poisoned")
            .artifact_listings
            .push(Ok(listings));
    }

    /// Queue a `list_artifacts` failure.
    pub fn script_artifact_listing_error(&self, message: &str) {
        self.inner
            .lock()
            .expect("fake cursor poisoned")
            .artifact_listings
            .push(Err(message.to_owned()));
    }

    /// Give an artifact path a body, with the content type S3 would serve.
    pub fn script_artifact_body(&self, path: &str, content_type: Option<&str>, bytes: &[u8]) {
        self.inner
            .lock()
            .expect("fake cursor poisoned")
            .artifact_bodies
            .insert(
                path.to_owned(),
                FetchedBody {
                    content_type: content_type.map(str::to_owned),
                    bytes: Ok(bytes::Bytes::copy_from_slice(bytes)),
                },
            );
    }

    /// Make one artifact path fail to download.
    pub fn script_artifact_body_error(&self, path: &str, message: &str) {
        self.inner
            .lock()
            .expect("fake cursor poisoned")
            .artifact_bodies
            .insert(
                path.to_owned(),
                FetchedBody {
                    content_type: None,
                    bytes: Err(message.to_owned()),
                },
            );
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

    /// Resolve once at least `at_least` calls match `predicate`.
    ///
    /// How a test waits for the service to have reached a particular API call
    /// before acting — a cancel that has to land while a prompt is mid-retry,
    /// say. A real primitive rather than a spin on [`Self::calls`]: polling
    /// makes the pass depend on scheduler luck and turns a hang into a spin.
    pub async fn wait_for_calls(&self, at_least: usize, predicate: impl Fn(&CursorCall) -> bool) {
        loop {
            // Registered before the count is read, so a call landing between
            // the two is a wake-up rather than a lost one.
            let called = self.called.notified();
            if self.calls().iter().filter(|call| predicate(call)).count() >= at_least {
                return;
            }
            called.await;
        }
    }

    /// Wait out the scripted create gate, if a test set one. Taken out of the
    /// lock first: the mutex is never held across an await.
    async fn await_create_gate(&self) {
        let gate = self
            .inner
            .lock()
            .expect("fake cursor poisoned")
            .create_gate
            .take();
        if let Some(gate) = gate {
            let _ = gate.await;
        }
    }

    /// Record a call and wake anything waiting on one.
    fn record(&self, call: CursorCall) {
        self.inner
            .lock()
            .expect("fake cursor poisoned")
            .calls
            .push(call);
        self.called.notify_waiters();
    }
}

impl CursorAgents for FakeCursor {
    async fn create_agent(
        &self,
        prompt: &str,
        repo: Option<&RepoUrl>,
        open_pull_request: bool,
        mcp_servers: &[McpServer],
        model: Option<&ModelChoice>,
    ) -> Result<(CursorAgentId, CursorRunId), rootcause::Report> {
        self.record(CursorCall::CreateAgent(
            prompt.to_owned(),
            repo.cloned(),
            open_pull_request,
            mcp_servers.to_vec(),
            model.cloned(),
        ));
        self.await_create_gate().await;
        let mut state = self.inner.lock().expect("fake cursor poisoned");
        if std::mem::take(&mut state.reject_create_for_repository)
            && let Some(repo) = repo
        {
            return Err(rootcause::report!(
                crate::domain::error::RepositoryUnavailable {
                    repo: repo.clone(),
                    reason: crate::domain::error::RepositoryRejection::Inaccessible,
                    detail: r#"{"error":{"code":"repository_access","message":"Repository not accessible"}}"#
                        .into(),
                }
            )
            .into_dynamic());
        }
        if std::mem::take(&mut state.reject_create) {
            return Err(rootcause::report!(crate::domain::error::PromptRejected(
                "rejected".into()
            ))
            .into_dynamic());
        }
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
        model: Option<&ModelChoice>,
    ) -> Result<CursorRunId, rootcause::Report> {
        self.record(CursorCall::CreateRun(
            agent.clone(),
            prompt.to_owned(),
            model.cloned(),
        ));
        self.await_create_gate().await;
        let mut state = self.inner.lock().expect("fake cursor poisoned");
        if !state.create_run_errors.is_empty() {
            let message = state.create_run_errors.remove(0);
            return Err(rootcause::report!("{message}"));
        }
        if std::mem::take(&mut state.reject_create) {
            return Err(rootcause::report!(crate::domain::error::PromptRejected(
                "rejected".into()
            ))
            .into_dynamic());
        }
        state.next_run += 1;
        Ok(CursorRunId::new(format!("run-fake-{}", state.next_run)))
    }

    async fn list_models(&self) -> Result<Vec<CursorModel>, rootcause::Report> {
        let gate = self.inner.lock().unwrap().model_gate.take();
        if let Some(gate) = gate {
            let _ = gate.await;
        }
        Ok(self
            .inner
            .lock()
            .expect("fake cursor poisoned")
            .models
            .clone())
    }

    async fn cancel_run(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> Result<(), rootcause::Report> {
        self.record(CursorCall::CancelRun(agent.clone(), run.clone()));
        Ok(())
    }

    async fn raw_result(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> Result<String, rootcause::Report> {
        self.record(CursorCall::RunResult(agent.clone(), run.clone()));
        let mut state = self.inner.lock().expect("fake cursor poisoned");
        if state.run_results.is_empty() {
            return Err(rootcause::report!("no scripted run result queued"));
        }
        let outcome = state.run_results.remove(0);
        Ok(
            serde_json::json!({"id": run, "status": outcome.status, "result": outcome.text})
                .to_string(),
        )
    }

    async fn list_runs(
        &self,
        _agent: &CursorAgentId,
        _through: Option<&CursorRunId>,
    ) -> Result<Vec<RunListing>, rootcause::Report> {
        Ok(self
            .inner
            .lock()
            .expect("fake cursor poisoned")
            .run_listings
            .clone())
    }

    async fn conversation(
        &self,
        agent: &CursorAgentId,
    ) -> Result<Vec<ConversationLine>, rootcause::Report> {
        self.record(CursorCall::Conversation(agent.clone()));
        Ok(self
            .inner
            .lock()
            .expect("fake cursor poisoned")
            .conversation
            .clone())
    }
}

/// What one scripted `raw_stream()` call answers with.
#[derive(Debug)]
enum ScriptedStream {
    /// Records the test pushes, optionally ending in a transport failure once
    /// the sender is dropped.
    Records {
        receiver: mpsc::UnboundedReceiver<NativeRecord>,
        failure: Option<String>,
    },
    /// A connect that never produces a stream.
    ConnectError(StreamConnectError),
}

impl CursorArtifacts for FakeCursor {
    async fn list_artifacts(
        &self,
        agent: &CursorAgentId,
    ) -> Result<Vec<ArtifactListing>, rootcause::Report> {
        self.record(CursorCall::ListArtifacts(agent.clone()));
        let mut state = self.inner.lock().expect("fake cursor poisoned");
        let answer = if state.artifact_listings.len() > 1 {
            state.artifact_listings.remove(0)
        } else {
            state
                .artifact_listings
                .first()
                .cloned()
                .unwrap_or(Ok(vec![]))
        };
        answer.map_err(|message| rootcause::report!("{message}"))
    }

    async fn fetch_artifact(
        &self,
        agent: &CursorAgentId,
        path: &str,
    ) -> Result<FetchedArtifact, rootcause::Report> {
        self.record(CursorCall::FetchArtifact(agent.clone(), path.to_owned()));
        let body = self
            .inner
            .lock()
            .expect("fake cursor poisoned")
            .artifact_bodies
            .get(path)
            .cloned();
        let body = body.ok_or_else(|| rootcause::report!("no scripted body for {path}"))?;
        Ok(FetchedArtifact {
            content_type: body.content_type,
            bytes: body
                .bytes
                .map_err(|message| rootcause::report!("{message}"))?,
        })
    }
}

/// An artifact store that keeps every file in memory and hands back a URL
/// derived from its name.
#[derive(Debug, Clone, Default)]
pub struct FakeArtifactStore {
    stored: Arc<Mutex<Vec<StoredArtifact>>>,
    failing: Arc<Mutex<Vec<String>>>,
}

/// One file a [`FakeArtifactStore`] was given.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredArtifact {
    /// The name it was stored under.
    pub name: String,
    /// The media type it was stored with.
    pub mime_type: String,
    /// Its bytes.
    pub bytes: Vec<u8>,
}

impl FakeArtifactStore {
    /// An empty store that accepts everything.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Make every attempt to store `name` fail.
    pub fn fail_for(&self, name: &str) {
        self.failing
            .lock()
            .expect("fake store poisoned")
            .push(name.to_owned());
    }

    /// Everything stored so far, in order.
    #[must_use]
    pub fn stored(&self) -> Vec<StoredArtifact> {
        self.stored.lock().expect("fake store poisoned").clone()
    }

    /// The URL this store answers with for `name`.
    #[must_use]
    pub fn uri(name: &str) -> String {
        format!("https://files.test/{name}")
    }
}

impl ArtifactStore for FakeArtifactStore {
    async fn store(
        &self,
        file_name: &str,
        mime_type: &str,
        bytes: bytes::Bytes,
    ) -> Result<String, rootcause::Report> {
        if self
            .failing
            .lock()
            .expect("fake store poisoned")
            .iter()
            .any(|name| name == file_name)
        {
            return Err(rootcause::report!("scripted store failure for {file_name}"));
        }
        self.stored
            .lock()
            .expect("fake store poisoned")
            .push(StoredArtifact {
                name: file_name.to_owned(),
                mime_type: mime_type.to_owned(),
                bytes: bytes.to_vec(),
            });
        Ok(Self::uri(file_name))
    }
}

impl RunStream for FakeCursor {
    async fn raw_stream(
        &self,
        _agent: &CursorAgentId,
        _run: &CursorRunId,
        resume_from: Option<&str>,
    ) -> Result<
        ConnectedStream<impl Stream<Item = Result<NativeRecord, rootcause::Report>> + Send>,
        StreamConnectError,
    > {
        let (receiver, failure, retention_seconds) = {
            let mut state = self.inner.lock().expect("fake cursor poisoned");
            state.resume_positions.push(resume_from.map(str::to_owned));
            if state.streams.is_empty() {
                return Err(StreamConnectError::Other(rootcause::report!(
                    "no scripted stream queued"
                )));
            }
            let retention_seconds = state.retention_seconds;
            match state.streams.remove(0) {
                ScriptedStream::ConnectError(error) => return Err(error),
                ScriptedStream::Records { receiver, failure } => {
                    (receiver, failure, retention_seconds)
                }
            }
        };
        let records =
            futures::stream::unfold((receiver, failure), |(mut receiver, failure)| async move {
                match receiver.recv().await {
                    Some(event) => Some((Ok(event), (receiver, failure))),
                    // The channel closing is the connection closing: a
                    // scripted failure is what the transport says as it goes.
                    None => failure
                        .map(|failure| (Err(rootcause::report!("{failure}")), (receiver, None))),
                }
            });
        Ok(ConnectedStream {
            records,
            retention_seconds,
        })
    }
}

type RecordedUpdates = Vec<(SessionId, SessionUpdate)>;

/// Records live updates and host-local reload requirements.
/// Tests of raw frame ordering use the served ACP transport instead.
#[derive(Debug, Clone, Default)]
pub struct RecordingNotifier {
    updates: Arc<Mutex<RecordedUpdates>>,
    reloads: Arc<Mutex<Vec<SessionId>>>,
    pull_requests: Arc<Mutex<Vec<String>>>,
    delivered: Arc<tokio::sync::Notify>,
}

impl RecordingNotifier {
    /// A notifier with nothing recorded.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The selected history and live updates, in order.
    #[must_use]
    pub fn updates(&self) -> Vec<(SessionId, SessionUpdate)> {
        self.updates.lock().expect("notifier poisoned").clone()
    }

    /// PRs handed to the host operation.
    pub fn pull_requests(&self) -> Vec<String> {
        self.pull_requests
            .lock()
            .expect("notifier poisoned")
            .clone()
    }

    /// Sessions whose recovered history needs a client load.
    pub fn reloads(&self) -> Vec<SessionId> {
        self.reloads.lock().expect("notifier poisoned").clone()
    }

    /// Resolve once `at_least` updates have been delivered.
    ///
    /// The way a test waits for a turn to have actually reached its stream.
    /// A real primitive rather than a spin on [`Self::updates`]: polling makes
    /// the pass depend on scheduler luck, and hides a hang behind a spin that
    /// never ends.
    pub async fn wait_for_updates(&self, at_least: usize) {
        loop {
            // Registered before the count is read, so an update delivered
            // between the two is a wake-up rather than a lost one.
            let delivered = self.delivered.notified();
            if self.updates().len() >= at_least {
                return;
            }
            delivered.await;
        }
    }
}

impl SessionNotifier for RecordingNotifier {
    async fn set_pull_request(
        &self,
        _session: &SessionId,
        url: &str,
    ) -> Result<(), rootcause::Report> {
        self.pull_requests
            .lock()
            .expect("notifier poisoned")
            .push(url.to_owned());
        Ok(())
    }

    async fn notify(
        &self,
        session: &SessionId,
        update: SessionUpdate,
    ) -> Result<(), rootcause::Report> {
        self.updates
            .lock()
            .expect("notifier poisoned")
            .push((session.clone(), update));
        self.delivered.notify_waiters();
        Ok(())
    }

    async fn require_reload(&self, session: &SessionId) -> Result<(), rootcause::Report> {
        self.reloads
            .lock()
            .expect("notifier poisoned")
            .push(session.clone());
        Ok(())
    }

    async fn turn_complete(
        &self,
        _session: &SessionId,
        _outcome: agent_runtime_protocol::domain::turn::TurnOutcome,
    ) -> Result<(), rootcause::Report> {
        Ok(())
    }

    async fn checkpoint(
        &self,
        _session: &SessionId,
        _run: &CursorRunId,
    ) -> Result<(), rootcause::Report> {
        Ok(())
    }
}

/// Answers every prompt with the same repository — or none — and the same
/// pull-request decision.
#[derive(Debug, Clone, Default)]
pub struct FixedChooser(pub Option<RepoUrl>, pub bool);

impl RepositoryChooser for FixedChooser {
    async fn choose(
        &self,
        _prompt: &str,
        _cwd: &std::path::Path,
    ) -> Result<SessionIntent, rootcause::Report> {
        Ok(SessionIntent {
            repository: self.0.clone(),
            open_pull_request: self.1,
        })
    }
}

/// Provide complete native history for a legacy restored-session test.
pub fn script_legacy_history(cursor: &FakeCursor) {
    use crate::domain::event::InteractionUpdate;
    use crate::domain::model::RunStatus;
    cursor.script_run_listings(vec![RunListing {
        id: CursorRunId::new("run-old"),
        status: RunStatus::Finished,
    }]);
    let tx = cursor.script_stream();
    tx.send(CursorEvent::Interaction(InteractionUpdate::UserMessage {
        text: "original prompt".into(),
    }))
    .unwrap();
    tx.send(CursorEvent::Result {
        run_id: CursorRunId::new("run-old"),
        status: RunStatus::Finished,
        text: None,
        duration_ms: None,
        git: None,
    })
    .unwrap();
    tx.send(CursorEvent::Done).unwrap();
}
