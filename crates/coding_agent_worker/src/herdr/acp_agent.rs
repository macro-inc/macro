//! `macrod herdr-acp`: an ACP agent whose sessions are live coding-agent TUIs
//! (Claude Code or Codex) in herdr windows.
//!
//! macrod runs this as its harness like any other ACP agent, so sessions
//! still open, prompt, stream, and stop through Macro's ACP infrastructure.
//! Behind the protocol, each session is a real interactive `claude` or
//! `codex` in its own herdr tab, rooted at the session's working directory:
//!
//! - the first `session/prompt` opens the tab and starts the agent there
//!   with the session's model and Macro MCP servers;
//! - prompts are typed into the TUI with `herdr agent prompt`;
//! - the agent's own session transcript is tailed and streamed back as
//!   `session/update`s, and its end-of-turn record ends the turn;
//! - a permission dialog in the TUI becomes a `session/request_permission`,
//!   answered by pressing the matching key; `session/cancel` presses Esc.
//!
//! Anyone watching the herdr window can also type into the TUI directly.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

use super::HerdrSession;
use super::cli::{HerdrCli, HerdrError};
use super::hub::title_from;
use super::store::{Record, Store, write_private};
use super::tail::Cursor;
use agent_fold::domain::transcript::{Fold, LogEvent};
use claude_fold::ClaudeLog;
use codex_fold::CodexLog;

mod commands;
mod effort;
mod models;

/// The subcommand macrod's harness config names to run this adapter.
pub(crate) const SUBCOMMAND: &str = "herdr-acp";

const MODEL_CONFIG_ID: &str = "model";
const DEFAULT_MODEL: &str = "default";
const CLAUDE_MODELS: &[(&str, &str)] = &[
    (DEFAULT_MODEL, "Default (Claude Code's choice)"),
    ("opus", "Opus"),
    ("sonnet", "Sonnet"),
    ("haiku", "Haiku"),
];
const CODEX_MODELS: &[(&str, &str)] = &[
    (DEFAULT_MODEL, "Default (Codex's choice)"),
    ("gpt-6-astra", "GPT-6 Astra"),
    ("gpt-5.6", "GPT-5.6"),
    ("gpt-5.5", "GPT-5.5"),
];
const POLL: Duration = Duration::from_millis(250);
/// Transcript polls per herdr status check.
const STATUS_EVERY: u32 = 4;
/// Consecutive ready status checks, with no transcript ending, that end a
/// turn anyway (slash commands and interrupted turns write no final message).
const SETTLED_CHECKS: u32 = 3;
/// How long a new tab's shell may take to reach its prompt.
const SHELL_READY_TIMEOUT: Duration = Duration::from_secs(10);
const QUIET_START: Duration = Duration::from_secs(20);
const MISSING_AGENT_CHECKS: u32 = 5;
/// Which coding-agent TUI each session runs.
#[derive(
    Debug,
    Clone,
    Copy,
    Default,
    PartialEq,
    Eq,
    clap::ValueEnum,
    serde::Serialize,
    serde::Deserialize,
)]
pub(crate) enum TuiAgent {
    /// Claude Code (`claude`).
    #[default]
    Claude,
    /// OpenAI Codex (`codex`).
    Codex,
}

impl TuiAgent {
    /// herdr's `--kind` for the agent, which is also its command.
    pub(crate) fn herdr_kind(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }

    fn models(self) -> &'static [(&'static str, &'static str)] {
        match self {
            Self::Claude => CLAUDE_MODELS,
            Self::Codex => CODEX_MODELS,
        }
    }

    fn log(self) -> Transcript {
        match self {
            Self::Claude => Transcript::Claude(ClaudeLog::default()),
            Self::Codex => Transcript::Codex(CodexLog::default()),
        }
    }
}

/// A session transcript reader for the agent that writes it.
enum Transcript {
    Claude(ClaudeLog),
    Codex(CodexLog),
}

impl Transcript {
    fn entry(&mut self, line: &str) -> Vec<LogEvent> {
        match self {
            Self::Claude(log) => log.entry(line),
            Self::Codex(log) => log.entry(line),
        }
    }
}

/// How `macrod herdr-acp` runs its agents.
#[derive(Debug, Clone, Default)]
pub(crate) struct AdapterOptions {
    /// Private storage shared with the dispatcher's repository preparation.
    pub state_dir: Option<PathBuf>,
    /// Native model ID for new sessions.
    pub model: Option<String>,
    /// Sessions use dispatcher-managed worktrees.
    pub managed_worktrees: bool,
    /// The agent TUI sessions run.
    pub kind: TuiAgent,
    /// Passed to Claude Code as `--permission-mode`.
    pub permission_mode: Option<String>,
    /// Open session windows in the background instead of switching to them.
    pub no_focus: bool,
    /// Extra arguments for every agent launch, after the adapter's own.
    pub agent_args: Vec<String>,
}

#[derive(Debug)]
struct RpcError {
    code: i64,
    message: String,
}

impl RpcError {
    fn internal(message: impl Into<String>) -> Self {
        Self {
            code: -32603,
            message: message.into(),
        }
    }

    fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: -32602,
            message: message.into(),
        }
    }
}

impl From<HerdrError> for RpcError {
    fn from(error: HerdrError) -> Self {
        Self::internal(error.to_string())
    }
}

mod environment {
    macro_env_var::maybe_env_var! {
        pub struct Home;
    }
}

/// Serve ACP on stdin/stdout until stdin closes.
pub async fn run(options: AdapterOptions) -> rootcause::Result<()> {
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Value>();
    let writer = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(message) = out_rx.recv().await {
            let mut line = message.to_string();
            line.push('\n');
            if stdout.write_all(line.as_bytes()).await.is_err() || stdout.flush().await.is_err() {
                return;
            }
        }
    });

    let herdr = HerdrSession::detect();
    let home = environment::Home::new().and_then(|home| home.value().map(PathBuf::from));
    let state_dir = options
        .state_dir
        .clone()
        .or_else(|| {
            home.as_ref()
                .map(|home| home.join(".macrod/herdr/standalone"))
        })
        .ok_or_else(|| rootcause::report!("HOME or --state-dir is required"))?;
    let shutdown = CancellationToken::new();
    let adapter = Arc::new(Adapter {
        out: out_tx,
        pending: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(0),
        sessions: Mutex::new(HashMap::new()),
        herdr: herdr
            .as_ref()
            .map(|herdr| HerdrCli::new(&herdr.bin, herdr.workspace_id.clone())),
        options,
        home,
        store: Store(state_dir),
        shutdown: shutdown.clone(),
        claimed: Mutex::new(std::collections::HashSet::new()),
    });

    let mut requests = tokio::task::JoinSet::new();
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Some(line) = lines.next_line().await? {
        while requests.try_join_next().is_some() {}
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let id = message.get("id").filter(|id| !id.is_null()).cloned();
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        match (message.get("method").and_then(Value::as_str), id) {
            (Some(method), Some(id)) => {
                let adapter = adapter.clone();
                let method = method.to_owned();
                requests.spawn(async move {
                    let prompt_session = if method == "session/prompt" {
                        adapter.session(&params).ok()
                    } else {
                        None
                    };
                    if prompt_session
                        .as_ref()
                        .is_some_and(|session| session.prompt_pending.swap(true, Ordering::SeqCst))
                    {
                        adapter.respond(
                            id,
                            Err(RpcError::invalid("a prompt is already in progress")),
                        );
                        return;
                    }
                    adapter.respond_to_request(id, &method, params).await;
                    if let Some(session) = prompt_session {
                        session.prompt_pending.store(false, Ordering::SeqCst);
                    }
                });
            }
            (Some("session/cancel"), None) => adapter.cancel(&params),
            (Some(_), None) => {}
            (None, Some(id)) => adapter.answered(&id, message),
            (None, None) => {}
        }
    }
    shutdown.cancel();
    requests.abort_all();
    while requests.join_next().await.is_some() {}
    lock(&adapter.pending).clear();
    drop(adapter);
    let _ = writer.await;
    Ok(())
}

struct Adapter {
    store: Store,
    shutdown: CancellationToken,
    out: mpsc::UnboundedSender<Value>,
    pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    next_id: AtomicU64,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    herdr: Option<HerdrCli>,
    options: AdapterOptions,
    home: Option<PathBuf>,
    /// Transcripts already bound to a session, so two sessions in the same
    /// directory never read the same Codex rollout.
    claimed: Mutex<std::collections::HashSet<PathBuf>>,
}

struct Session {
    id: String,
    cwd: PathBuf,
    mcp_servers: Vec<Value>,
    model: Mutex<String>,
    effort: Mutex<Option<String>>,
    native_id: Mutex<Option<String>>,
    prompt_pending: AtomicBool,
    live: tokio::sync::Mutex<Option<Live>>,
    cancel: Mutex<Option<CancellationToken>>,
}

struct PermissionEpoch(Arc<AtomicU64>);
impl Drop for PermissionEpoch {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

struct PromptCancellation<'a>(&'a Mutex<Option<CancellationToken>>);

impl Drop for PromptCancellation<'_> {
    fn drop(&mut self) {
        lock(self.0).take();
    }
}

/// A session's running TUI.
struct Live {
    session: String,
    cwd: PathBuf,
    started: std::time::SystemTime,
    name: String,
    log: Transcript,
    path: Option<PathBuf>,
    cursor: Cursor,
    pending: VecDeque<LogEvent>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Adapter {
    fn send(&self, message: Value) {
        let _ = self.out.send(message);
    }

    fn respond(&self, id: Value, result: Result<Value, RpcError>) {
        self.send(match result {
            Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
            Err(error) => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {"code": error.code, "message": error.message},
            }),
        });
    }

    fn notify_update(&self, session: &str, update: Value) {
        self.send(json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {"sessionId": session, "update": update},
        }));
    }

    /// Send a request to the client and wait for its answer.
    async fn call(&self, method: &str, params: Value) -> Option<Value> {
        let id = format!(
            "macrod-herdr-{}",
            self.next_id.fetch_add(1, Ordering::Relaxed)
        );
        let (tx, rx) = oneshot::channel();
        lock(&self.pending).insert(Value::String(id.clone()).to_string(), tx);
        self.send(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}));
        let answer = tokio::select! {
            answer = rx => answer.ok(),
            () = self.shutdown.cancelled() => None,
        };
        lock(&self.pending).remove(&Value::String(id).to_string());
        answer
    }

    fn answered(&self, id: &Value, message: Value) {
        if let Some(waiter) = lock(&self.pending).remove(&id.to_string()) {
            let _ = waiter.send(message);
        }
    }

    fn session(&self, params: &Value) -> Result<Arc<Session>, RpcError> {
        let id = params
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| RpcError::invalid("missing sessionId"))?;
        lock(&self.sessions)
            .get(id)
            .cloned()
            .ok_or_else(|| RpcError::invalid(format!("unknown session {id}")))
    }

    fn cancel(self: &Arc<Self>, params: &Value) {
        let Ok(session) = self.session(params) else {
            return;
        };
        if let Some(cancel) = lock(&session.cancel).as_ref() {
            cancel.cancel();
            return;
        }
        let Some(herdr) = self.herdr.clone() else {
            return;
        };
        let name = agent_name(&session.id);
        let native_id = lock(&session.native_id).clone();
        tokio::spawn(async move {
            let Ok(info) = herdr.agent_info(&name).await else {
                return;
            };
            if native_id.is_some()
                && info.session_id == native_id
                && matches!(info.status.as_str(), "working" | "blocked")
                && let Err(error) = herdr.send_keys(&name, &["esc"]).await
            {
                tracing::warn!(%error, "could not interrupt native turn");
            }
        });
    }

    async fn request(self: &Arc<Self>, method: &str, params: Value) -> Result<Value, RpcError> {
        match method {
            "initialize" => Ok(json!({
                "protocolVersion": 1,
                "agentCapabilities": {
                    "loadSession": true,
                    "promptCapabilities": {"image": false, "audio": false, "embeddedContext": false},
                },
                "authMethods": [],
                "agentInfo": {"name": "macrod-herdr", "version": env!("CARGO_PKG_VERSION")},
            })),
            "session/new" => self.new_session(&params),
            "session/load" => self.load_session(&params).await,
            "session/set_config_option" => {
                let session = self.session(&params)?;
                let value = params
                    .get("value")
                    .and_then(Value::as_str)
                    .ok_or_else(|| RpcError::invalid("missing configuration value"))?;
                match params.get("configId").and_then(Value::as_str) {
                    Some(MODEL_CONFIG_ID) => self.set_model(&session, value).await,
                    Some(effort::CONFIG_ID) if self.options.kind == TuiAgent::Codex => {
                        self.set_effort(&session, value).await
                    }
                    _ => Err(RpcError::invalid("unsupported configuration option")),
                }
            }
            "session/prompt" => {
                let session = self.session(&params)?;
                let text = prompt_text(params.get("prompt").unwrap_or(&Value::Null));
                self.prompt(&session, &text)
                    .await
                    .map(|stop| json!({"stopReason": stop}))
            }
            _ => Err(RpcError {
                code: -32601,
                message: format!("{method} is not supported"),
            }),
        }
    }

    fn new_session(self: &Arc<Self>, params: &Value) -> Result<Value, RpcError> {
        let id = uuid::Uuid::new_v4().to_string();
        let cwd = params
            .get("cwd")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .ok_or_else(|| RpcError::invalid("missing cwd"))?;
        let session = Arc::new(Session {
            id: id.clone(),
            cwd,
            mcp_servers: params
                .get("mcpServers")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            model: Mutex::new(
                self.options
                    .model
                    .clone()
                    .unwrap_or_else(|| DEFAULT_MODEL.to_owned()),
            ),
            native_id: Mutex::new(None),
            effort: Mutex::new(None),
            prompt_pending: AtomicBool::new(false),
            live: tokio::sync::Mutex::new(None),
            cancel: Mutex::new(None),
        });
        self.save(&session, None)?;
        lock(&self.sessions).insert(id.clone(), session.clone());
        self.observe(&session);
        Ok(json!({"sessionId": id, "configOptions": self.session_options(&session)}))
    }

    fn save(&self, session: &Session, live: Option<&Live>) -> Result<(), RpcError> {
        self.store
            .save(&Record {
                version: 1,
                id: session.id.clone(),
                kind: self.options.kind,
                cwd: session.cwd.clone(),
                model: lock(&session.model).clone(),
                native_id: lock(&session.native_id).clone(),
                transcript: live.and_then(|live| live.path.clone()),
                started: live
                    .map(|live| live.started)
                    .unwrap_or_else(std::time::SystemTime::now)
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            })
            .map_err(|error| RpcError::internal(format!("could not save native session: {error}")))
    }

    async fn load_session(self: &Arc<Self>, params: &Value) -> Result<Value, RpcError> {
        let id = params
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| RpcError::invalid("missing sessionId"))?;
        let existing = lock(&self.sessions).get(id).cloned();
        if let Some(existing) = &existing {
            let mut live = existing
                .live
                .try_lock()
                .map_err(|_| RpcError::invalid("cannot reload during a Macro prompt"))?;
            if existing.prompt_pending.load(Ordering::SeqCst) {
                return Err(RpcError::invalid("cannot reload during a Macro prompt"));
            }
            *live = None;
            lock(&self.sessions).remove(id);
        }
        let record = self.store.load(id).map_err(|error| {
            RpcError::internal(format!("could not restore native session: {error}"))
        })?;
        if record.kind != self.options.kind
            || params.get("cwd").and_then(Value::as_str).map(Path::new)
                != Some(record.cwd.as_path())
        {
            return Err(RpcError::invalid(
                "saved session belongs to a different agent or workspace",
            ));
        }
        let mut live = Live {
            session: id.to_owned(),
            cwd: record.cwd.clone(),
            started: std::time::UNIX_EPOCH + Duration::from_secs(record.started),
            name: agent_name(id),
            log: self.options.kind.log(),
            path: record.transcript,
            cursor: Cursor::default(),
            pending: VecDeque::new(),
        };
        if live.path.is_none() {
            live.path = self.locate(&live, record.native_id.as_deref());
        }
        let session = Arc::new(Session {
            id: id.to_owned(),
            cwd: record.cwd,
            mcp_servers: params
                .get("mcpServers")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            model: Mutex::new(record.model.clone()),
            effort: Mutex::new(None),
            native_id: Mutex::new(record.native_id),
            prompt_pending: AtomicBool::new(false),
            live: tokio::sync::Mutex::new(None),
            cancel: Mutex::new(None),
        });
        // ACP load stages this complete history until our successful response.
        loop {
            let offset = live.cursor.offset;
            self.forward(&session, &mut live, &mut None)?;
            if offset == live.cursor.offset && live.pending.is_empty() {
                break;
            }
        }
        self.sync_model(&session, &live).await;
        *session.live.lock().await = Some(live);
        lock(&self.sessions).insert(id.to_owned(), session.clone());
        self.observe(&session);
        Ok(json!({"configOptions": self.session_options(&session)}))
    }

    fn observe(self: &Arc<Self>, session: &Arc<Session>) {
        let adapter = Arc::downgrade(self);
        let session = Arc::downgrade(session);
        let shutdown = self.shutdown.clone();
        tokio::spawn(async move {
            let mut ticks = 0u32;
            loop {
                tokio::select! {
                    () = shutdown.cancelled() => break,
                    () = tokio::time::sleep(POLL) => {}
                }
                let (Some(adapter), Some(session)) = (adapter.upgrade(), session.upgrade()) else {
                    break;
                };
                if session.prompt_pending.load(Ordering::SeqCst) {
                    continue;
                }
                // A Macro prompt owns the reader until its response is sent.
                let Ok(mut guard) = session.live.try_lock() else {
                    continue;
                };
                let Some(live) = guard.as_mut() else {
                    continue;
                };
                ticks = ticks.wrapping_add(1);
                if let Err(error) = adapter.forward(&session, live, &mut None) {
                    tracing::warn!(session = %session.id, error = %error.message, "native transcript observation stopped");
                    adapter.turn_complete(&session.id, "failed");
                    break;
                }
                if ticks.is_multiple_of(STATUS_EVERY) {
                    adapter.sync_model(&session, live).await;
                }
            }
        });
    }

    fn turn_complete(&self, session: &str, stop: &str) {
        let outcome = match stop {
            "cancelled" => json!({"kind":"cancelled"}),
            "failed" => {
                json!({"kind":"failed", "message":"native transcript could not be read; reload the session"})
            }
            _ => json!({"kind":"finished"}),
        };
        self.send(json!({"jsonrpc":"2.0", "method":"_session/turn_complete", "params":{"sessionId":session, "outcome":outcome}}));
    }

    async fn prompt(
        self: &Arc<Self>,
        session: &Arc<Session>,
        text: &str,
    ) -> Result<&'static str, RpcError> {
        let herdr = self.herdr.as_ref().ok_or_else(|| {
            RpcError::internal("macrod herdr-acp needs a macrod started inside herdr")
        })?;
        let cancel = CancellationToken::new();
        *lock(&session.cancel) = Some(cancel.clone());
        let _cancellation = PromptCancellation(&session.cancel);

        let mut guard = session.live.lock().await;
        if let Some(live) = guard.as_ref() {
            match herdr.agent_info(&live.name).await {
                Ok(info) if matches!(info.status.as_str(), "working" | "blocked") => {
                    return Err(RpcError::invalid(
                        "the native session is busy; finish its current turn in Herdr first",
                    ));
                }
                Ok(info) => {
                    if info.cwd.as_ref().is_some_and(|cwd| cwd != &session.cwd)
                        || info
                            .session_id
                            .as_ref()
                            .zip(lock(&session.native_id).as_ref())
                            .is_some_and(|(actual, expected)| actual != expected)
                    {
                        return Err(RpcError::invalid(
                            "Herdr agent identity no longer matches this session",
                        ));
                    }
                }
                Err(error) if error.missing_agent() => {
                    let old = guard.take().expect("live session was checked above");
                    let mut restarted = self.launch(herdr, session, text).await?;
                    restarted.path = old.path;
                    restarted.cursor = old.cursor;
                    restarted.log = old.log;
                    restarted.pending = old.pending;
                    *guard = Some(restarted);
                    self.save(session, guard.as_ref())?;
                }
                Err(error) => return Err(error.into()),
            }
        }
        if guard.is_none() {
            *guard = Some(self.launch(herdr, session, text).await?);
            self.save(session, guard.as_ref())?;
        }
        let Some(live) = guard.as_mut() else {
            return Err(RpcError::internal("the Claude Code window did not start"));
        };

        if live.pending.is_empty() {
            live.pending = self.drain(live)?.into();
        }
        while let Some(LogEvent::ModelChanged(_)) = live.pending.front() {
            let Some(LogEvent::ModelChanged(model)) = live.pending.pop_front() else {
                unreachable!()
            };
            self.report_model(session, live, &model)?;
        }
        if !live.pending.is_empty() {
            return Err(RpcError::invalid(
                "the native transcript has new activity; retry once it has synchronized",
            ));
        }
        // The observer cannot acquire this session until the turn ends. Publish
        // native settings now, while the freshly started composer is visible.
        self.sync_model(session, live).await;
        if self.options.kind == TuiAgent::Codex
            && let Some(requested) = effort::command(text)
        {
            let requested = requested?;
            let message = tokio::select! {
                () = cancel.cancelled() => return Ok("cancelled"),
                result = tokio::time::timeout(Duration::from_secs(20), self.codex_effort(session, live, requested)) => {
                    result.map_err(|_| RpcError::internal("effort change was not confirmed; check the native session in Herdr"))??
                }
            };
            self.notify_update(
                &session.id,
                json!({
                    "sessionUpdate":"agent_message_chunk", "content":{"type":"text","text":message},
                }),
            );
            return Ok("end_turn");
        }
        herdr.prompt_agent(&live.name, text).await?;
        if let Some(command) = commands::native_control(self.options.kind, text) {
            // Herdr acknowledges PTY delivery, not the resulting setting. These
            // commands need not write a transcript entry or start a model turn.
            self.notify_update(&session.id, json!({
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": format!(
                    "Sent `{command}` to {} in Herdr. Check its response and complete any confirmation there.",
                    self.options.kind.herdr_kind(),
                )},
            }));
            return Ok("end_turn");
        }
        let outcome = self.follow(herdr, session, live, &cancel).await;
        *lock(&session.cancel) = None;
        self.save(session, guard.as_ref())?;
        outcome
    }

    /// Open the session's herdr window and start the agent in it.
    async fn launch(
        &self,
        herdr: &HerdrCli,
        session: &Session,
        first_prompt: &str,
    ) -> Result<Live, RpcError> {
        let kind = self.options.kind;
        let label = title_from(first_prompt).unwrap_or_else(|| kind.herdr_kind().to_owned());
        let window = if self.options.managed_worktrees {
            let source = crate::outbound::git::primary_worktree(&session.cwd)
                .await
                .map_err(|error| RpcError::internal(error.to_string()))?;
            herdr
                .open_worktree(&source, &session.cwd, &label, !self.options.no_focus)
                .await?
        } else {
            herdr
                .open_window(&session.cwd, &label, !self.options.no_focus)
                .await?
        };

        let model = lock(&session.model).clone();
        let mut args = Vec::new();
        let resume = lock(&session.native_id).clone();
        if let Some(id) = &resume {
            args.extend([
                if kind == TuiAgent::Claude {
                    "--resume"
                } else {
                    "resume"
                }
                .to_owned(),
                id.clone(),
            ]);
        }
        if model != DEFAULT_MODEL && resume.is_none() {
            args.extend(["--model".to_owned(), model.clone()]);
        }
        if kind == TuiAgent::Claude {
            if resume.is_none() {
                args.extend(["--session-id".to_owned(), session.id.clone()]);
            }
            if let Some(mode) = &self.options.permission_mode {
                args.extend(["--permission-mode".to_owned(), mode.clone()]);
            }
            if let Some(config) = self.write_mcp_config(session)? {
                args.extend([
                    "--mcp-config".to_owned(),
                    config.to_string_lossy().into_owned(),
                ]);
            }
        }
        if kind == TuiAgent::Codex && !session.mcp_servers.is_empty() {
            let prepared = super::mcp::codex(
                &self.store.0.join("mcp").join(&session.id),
                &session.mcp_servers,
            )
            .map_err(|error| RpcError::internal(error.to_string()))?;
            herdr
                .run_in_pane(
                    &window.pane_id,
                    &format!(
                        ". {}",
                        shell_words::quote(&prepared.environment.to_string_lossy())
                    ),
                )
                .await?;
            args.extend(prepared.args);
        }
        args.extend(self.options.agent_args.iter().cloned());
        let name = agent_name(&session.id);
        let started = std::time::SystemTime::now();
        // The tab's shell must reach its prompt before an agent can start,
        // and a worktree's direnv can hold it for seconds.
        let deadline = tokio::time::Instant::now() + SHELL_READY_TIMEOUT;
        loop {
            match herdr
                .start_agent(&name, kind.herdr_kind(), &window.pane_id, &args)
                .await
            {
                Err(error) if error.pane_busy() && tokio::time::Instant::now() < deadline => {
                    tokio::time::sleep(POLL).await;
                }
                result => break result?,
            }
        }
        tracing::info!(
            session = %session.id,
            pane = %window.pane_id,
            agent = kind.herdr_kind(),
            "agent started in herdr"
        );
        if kind == TuiAgent::Claude {
            *lock(&session.native_id) = Some(session.id.clone());
        }
        Ok(Live {
            session: session.id.clone(),
            cwd: session.cwd.clone(),
            started,
            name,
            log: self.options.kind.log(),
            path: None,
            cursor: Cursor::default(),
            pending: VecDeque::new(),
        })
    }

    /// Hand Claude Code the MCP servers Macro gave the session, in a file
    /// only this user can read: the entries carry session credentials.
    fn write_mcp_config(&self, session: &Session) -> Result<Option<PathBuf>, RpcError> {
        let servers = claude_mcp_servers(&session.mcp_servers);
        if servers.is_empty() {
            return Ok(None);
        }
        let dir = self.store.0.join("mcp");
        std::fs::create_dir_all(&dir).map_err(|error| RpcError::internal(error.to_string()))?;
        let path = dir.join(format!("{}.mcp.json", session.id));
        let body = json!({"mcpServers": servers}).to_string();
        write_private(&path, body.as_bytes())
            .map_err(|error| RpcError::internal(error.to_string()))?;
        Ok(Some(path))
    }

    /// Stream the turn from the transcript until it ends.
    async fn follow(
        self: &Arc<Self>,
        herdr: &HerdrCli,
        session: &Arc<Session>,
        live: &mut Live,
        cancel: &CancellationToken,
    ) -> Result<&'static str, RpcError> {
        let started = Instant::now();
        let mut ticks = 0u32;
        let mut settled = 0u32;
        let mut missing = 0u32;
        let mut active = false;
        let mut open_tool: Option<(String, String)> = None;
        // Bumped whenever a dialog is asked about or goes away, so a late
        // answer from Macro never presses keys into a different dialog.
        let generation = Arc::new(AtomicU64::new(0));
        let mut asking = false;
        let mut last_output = Instant::now();
        let mut asked_seq = None;
        let _epoch = PermissionEpoch(generation.clone());
        loop {
            tokio::select! {
                () = cancel.cancelled() => {
                    herdr.send_keys(&live.name, &["esc"]).await?;
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    self.forward(session, live, &mut open_tool)?;
                    return Ok("cancelled");
                }
                () = tokio::time::sleep(POLL) => {}
            }
            let (moved, ended) = self.forward(session, live, &mut open_tool)?;
            if moved {
                last_output = Instant::now();
            }
            if let Some(stop) = ended {
                return Ok(stop);
            }

            ticks += 1;
            if !ticks.is_multiple_of(STATUS_EVERY) {
                continue;
            }
            // A startup screen may have hidden the footer before submission.
            // Retry without waiting for a model response to release the observer.
            let needs_settings = lock(&session.effort).is_none();
            if needs_settings {
                self.sync_model(session, live).await;
            }
            let info = match herdr.agent_info(&live.name).await {
                Ok(info) => {
                    missing = 0;
                    if info.session_id.is_some() {
                        *lock(&session.native_id) = info.session_id.clone();
                    }
                    if live.path.is_none() {
                        live.path = self.locate(live, info.session_id.as_deref());
                    }
                    self.save(session, Some(live))?;
                    info
                }
                Err(error) => {
                    missing += 1;
                    if missing >= MISSING_AGENT_CHECKS {
                        return Err(RpcError::internal(format!(
                            "the agent's herdr window is gone: {error}"
                        )));
                    }
                    continue;
                }
            };
            let status = info.status;
            if asked_seq.is_some_and(|seq| seq != info.state_change_seq) {
                asking = false;
                generation.fetch_add(1, Ordering::SeqCst);
            }
            if status != "blocked" && std::mem::take(&mut asking) {
                generation.fetch_add(1, Ordering::SeqCst);
            }
            match status.as_str() {
                "working" => {
                    active = true;
                    settled = 0;
                }
                "blocked" => {
                    settled = 0;
                    if !std::mem::replace(&mut asking, true) {
                        asked_seq = Some(info.state_change_seq);
                        let current = generation.fetch_add(1, Ordering::SeqCst) + 1;
                        self.ask_permission(session, live, open_tool.clone(), current, &generation);
                    }
                }
                "idle" | "done" => {
                    settled += 1;
                    if active
                        && settled >= SETTLED_CHECKS
                        && last_output.elapsed() >= Duration::from_secs(3)
                    {
                        self.forward(session, live, &mut open_tool)?;
                        return Ok("end_turn");
                    }
                    if !active && started.elapsed() > QUIET_START {
                        return Err(RpcError::internal(
                            "the native TUI did not confirm prompt submission; check its input in Herdr",
                        ));
                    }
                }
                _ => {}
            }
        }
    }

    /// Relay new transcript lines. Returns whether anything moved and the
    /// stop reason if the turn ended.
    fn forward(
        &self,
        session: &Session,
        live: &mut Live,
        open_tool: &mut Option<(String, String)>,
    ) -> Result<(bool, Option<&'static str>), RpcError> {
        let mut moved = false;
        let mut ended = None;
        if live.pending.is_empty() {
            live.pending = self.drain(live)?.into();
        }
        while let Some(event) = live.pending.pop_front() {
            match event {
                LogEvent::ModelChanged(model) => {
                    self.report_model(session, live, &model)?;
                }
                LogEvent::Update(update) => {
                    moved = true;
                    // Codex logs a command only once it has run, so its log
                    // never names the call a permission dialog is about.
                    if self.options.kind == TuiAgent::Claude {
                        track_open_tool(open_tool, &update);
                    }
                    self.notify_update(&session.id, update);
                }
                LogEvent::TurnEnded(stop) => {
                    self.turn_complete(&session.id, stop);
                    ended = Some(stop);
                    break;
                }
            }
        }
        Ok((moved, ended))
    }

    /// Ask Macro about the TUI's permission dialog, then press the key for
    /// the answer - unless the dialog was already answered in the window.
    fn ask_permission(
        self: &Arc<Self>,
        session: &Arc<Session>,
        live: &Live,
        tool: Option<(String, String)>,
        generation: u64,
        blocked: &Arc<AtomicU64>,
    ) {
        let Some(herdr) = self.herdr.clone() else {
            return;
        };
        let adapter = self.clone();
        let session_id = session.id.clone();
        let name = live.name.clone();
        let blocked = blocked.clone();
        let kind = self.options.kind;
        tokio::spawn(async move {
            let Ok(before) = herdr.agent_info(&name).await else {
                return;
            };
            let Ok(screen) = herdr.read_agent(&name).await else {
                return;
            };
            let Some(approve_key) = super::controls::approve_key(kind, &screen) else {
                adapter.notify_update(&session_id, json!({"sessionUpdate":"agent_message_chunk", "content":{"type":"text", "text":"The native agent needs input in Herdr."}}));
                return;
            };
            if before.status != "blocked" {
                return;
            }
            let (tool_id, title) = match tool {
                Some(tool) => tool,
                None => (
                    format!("herdr-permission-{generation}"),
                    permission_title(kind, &screen),
                ),
            };
            let answer = adapter
                .call(
                    "session/request_permission",
                    json!({
                        "sessionId": session_id,
                        "toolCall": {"toolCallId": tool_id, "title": title, "status": "pending"},
                        "options": [
                            {"optionId": "allow", "name": "Allow", "kind": "allow_once"},
                            {"optionId": "reject", "name": "Reject", "kind": "reject_once"},
                        ],
                    }),
                )
                .await;
            if blocked.load(Ordering::SeqCst) != generation {
                return;
            }
            let Ok(after) = herdr.agent_info(&name).await else {
                return;
            };
            let Ok(current_screen) = herdr.read_agent(&name).await else {
                return;
            };
            if !super::controls::same_dialog(
                &screen,
                &current_screen,
                before.state_change_seq,
                after.state_change_seq,
                &after.status,
            ) {
                return;
            }
            let key = match answer
                .as_ref()
                .and_then(|answer| answer.pointer("/result/outcome/optionId"))
                .and_then(Value::as_str)
            {
                Some("allow") => approve_key,
                Some("reject") => "esc",
                _ => return,
            };
            if blocked.load(Ordering::SeqCst) != generation {
                return;
            }
            if let Err(error) = herdr.send_keys(&name, &[key]).await {
                tracing::warn!(error = %error, "could not answer the agent's permission dialog");
            }
        });
    }

    /// Where the agent writes the session's transcript, once it exists.
    /// Claude Code names it after the id this adapter gave it; Codex mints
    /// its own id, which herdr reports once the session is live.
    fn locate(&self, live: &Live, agent_session: Option<&str>) -> Option<PathBuf> {
        let home = self.home.as_deref()?;
        let path = match self.options.kind {
            TuiAgent::Claude => find_claude_transcript(&home.join(".claude"), &live.session),
            TuiAgent::Codex => {
                let sessions = home.join(".codex").join("sessions");
                let claimed = lock(&self.claimed);
                agent_session
                    .and_then(|id| find_codex_rollout(&sessions, id))
                    .or_else(|| newest_codex_rollout(&sessions, &live.cwd, live.started, &claimed))
            }
        }?;
        lock(&self.claimed).insert(path.clone());
        Some(path)
    }

    /// Read whole new lines from the session's transcript.
    fn drain(&self, live: &mut Live) -> Result<Vec<LogEvent>, RpcError> {
        if live.path.is_none() {
            live.path = self.locate(live, None);
        }
        let Some(path) = &live.path else {
            return Ok(Vec::new());
        };
        let lines = live.cursor.read(path).map_err(|error| {
            RpcError::internal(format!("could not read native transcript: {error}"))
        })?;
        Ok(lines
            .into_iter()
            .flat_map(|line| live.log.entry(&line))
            .collect())
    }
}

/// What a permission dialog on the agent's screen is asking about.
pub(crate) fn permission_title(kind: TuiAgent, screen: &str) -> String {
    let lines: Vec<&str> = screen.lines().map(str::trim).collect();
    let asked = lines
        .iter()
        .rposition(|line| line.starts_with("Would you like to"))
        .map(|index| (lines[index], &lines[index + 1..]));
    if let Some((question, rest)) = asked {
        if let Some(command) = rest.iter().find_map(|line| line.strip_prefix("$ ")) {
            return format!("Run {}", clip_title(command));
        }
        if question.contains("edit") {
            return "Edit files".to_owned();
        }
        if let Some(reason) = rest.iter().find_map(|line| line.strip_prefix("Reason: ")) {
            return clip_title(reason);
        }
    }
    match kind {
        TuiAgent::Claude => "Claude Code is asking for permission".to_owned(),
        TuiAgent::Codex => "Codex is asking for permission".to_owned(),
    }
}

fn clip_title(text: &str) -> String {
    const LIMIT: usize = 80;
    let mut clipped: String = text.chars().take(LIMIT).collect();
    if text.chars().count() > LIMIT {
        clipped.push('…');
    }
    clipped
}

fn track_open_tool(open_tool: &mut Option<(String, String)>, update: &Value) {
    let id = update.get("toolCallId").and_then(Value::as_str);
    match update.get("sessionUpdate").and_then(Value::as_str) {
        Some("tool_call") => {
            let title = update
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default();
            *open_tool = id.map(|id| (id.to_owned(), title.to_owned()));
        }
        Some("tool_call_update") if open_tool.as_ref().map(|(open, _)| open.as_str()) == id => {
            *open_tool = None;
        }
        _ => {}
    }
}

/// A herdr agent name for the session: `[a-z][a-z0-9_-]{0,31}`.
pub(crate) fn agent_name(session: &str) -> String {
    let short: String = session
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(12)
        .collect::<String>()
        .to_ascii_lowercase();
    format!("macro-{short}")
}

fn config_options(kind: TuiAgent, current: &str) -> Value {
    let mut options = kind
        .models()
        .iter()
        .map(|(value, name)| json!({"value": value, "name": name}))
        .collect::<Vec<_>>();
    if !kind.models().iter().any(|(value, _)| *value == current) {
        options.push(json!({"value": current, "name": current}));
    }
    json!([{
        "id": MODEL_CONFIG_ID,
        "name": "Model",
        "category": "model",
        "type": "select",
        "currentValue": current,
        "options": options,
    }])
}

pub(crate) fn prompt_text(prompt: &Value) -> String {
    prompt
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|block| match block.get("type").and_then(Value::as_str)? {
            "text" => block.get("text").and_then(Value::as_str).map(str::to_owned),
            "resource_link" => block
                .get("uri")
                .and_then(Value::as_str)
                .map(|uri| format!("@{}", uri.strip_prefix("file://").unwrap_or(uri))),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// ACP `mcpServers` entries in Claude Code's `--mcp-config` shape.
pub(crate) fn claude_mcp_servers(servers: &[Value]) -> serde_json::Map<String, Value> {
    let pairs = |list: Option<&Value>| -> serde_json::Map<String, Value> {
        list.and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|pair| {
                Some((
                    pair.get("name")?.as_str()?.to_owned(),
                    pair.get("value")?.clone(),
                ))
            })
            .collect()
    };
    servers
        .iter()
        .filter_map(|server| {
            let name = server.get("name")?.as_str()?.to_owned();
            let config = match server.get("type").and_then(Value::as_str) {
                Some(kind @ ("http" | "sse")) => json!({
                    "type": kind,
                    "url": server.get("url")?,
                    "headers": pairs(server.get("headers")),
                }),
                _ => json!({
                    "command": server.get("command")?,
                    "args": server.get("args").cloned().unwrap_or_else(|| json!([])),
                    "env": pairs(server.get("env")),
                }),
            };
            Some((name, config))
        })
        .collect()
}

fn codex_rollouts(sessions: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![sessions.to_owned()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for path in entries.filter_map(Result::ok).map(|entry| entry.path()) {
            if path.is_dir() {
                stack.push(path);
            } else if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("rollout-") && name.ends_with(".jsonl"))
            {
                found.push(path);
            }
        }
    }
    found
}

/// The newest unclaimed rollout Codex started in `cwd` since `since`, for
/// when herdr cannot name the Codex session.
fn newest_codex_rollout(
    sessions: &Path,
    cwd: &Path,
    since: std::time::SystemTime,
    claimed: &std::collections::HashSet<PathBuf>,
) -> Option<PathBuf> {
    let since = since
        .checked_sub(Duration::from_secs(2))
        .unwrap_or(std::time::UNIX_EPOCH);
    codex_rollouts(sessions)
        .into_iter()
        .filter(|path| !claimed.contains(path))
        .filter_map(|path| {
            let modified = std::fs::metadata(&path)
                .and_then(|meta| meta.modified())
                .ok()?;
            (modified >= since).then_some((modified, path))
        })
        .filter(|(_, path)| rollout_cwd(path).is_some_and(|dir| dir == cwd))
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

/// The working directory in a rollout's leading `session_meta` record.
fn rollout_cwd(path: &Path) -> Option<PathBuf> {
    use std::io::BufRead as _;
    let mut first = String::new();
    std::io::BufReader::new(std::fs::File::open(path).ok()?)
        .read_line(&mut first)
        .ok()?;
    let meta: Value = serde_json::from_str(&first).ok()?;
    (meta.get("type")?.as_str()? == "session_meta")
        .then(|| meta.pointer("/payload/cwd")?.as_str().map(PathBuf::from))
        .flatten()
}

/// `rollout-<time>-<session>.jsonl` under Codex's dated session folders.
fn find_codex_rollout(sessions: &Path, session: &str) -> Option<PathBuf> {
    if session.is_empty() {
        return None;
    }
    let suffix = format!("-{session}.jsonl");
    codex_rollouts(sessions).into_iter().find(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(&suffix))
    })
}

fn find_claude_transcript(claude_home: &Path, session: &str) -> Option<PathBuf> {
    if session.is_empty() {
        return None;
    }
    let file = format!("{session}.jsonl");
    std::fs::read_dir(claude_home.join("projects"))
        .ok()?
        .filter_map(Result::ok)
        .map(|project| project.path().join(&file))
        .find(|path| path.is_file())
}

#[cfg(test)]
mod test;
