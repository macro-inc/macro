//! `macrod herdr-acp`: an ACP agent whose sessions are live coding-agent TUIs
//! (Claude Code or Codex) in herdr windows.
//!
//! macrod runs this as its harness like any other ACP agent, so sessions
//! still open, prompt, stream, and stop through Macro's ACP infrastructure.
//! Behind the protocol, each session is a real interactive `claude` or
//! `codex` in its own herdr tab, rooted at the session's working directory:
//!
//! - the first `session/prompt` opens the tab and starts the agent there
//!   with the session's model (and, for Claude Code, its id and Macro MCP
//!   servers);
//! - prompts are typed into the TUI with `herdr agent prompt`;
//! - the agent's own session transcript is tailed and streamed back as
//!   `session/update`s, and its end-of-turn record ends the turn;
//! - a permission dialog in the TUI becomes a `session/request_permission`,
//!   answered by pressing the matching key; `session/cancel` presses Esc.
//!
//! Anyone watching the herdr window can also type into the TUI directly.

use std::collections::HashMap;
use std::io::{Read as _, Seek as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

use super::HerdrSession;
use super::claude_log::{ClaudeLog, LogEvent};
use super::cli::{HerdrCli, HerdrError};
use super::codex_log::CodexLog;
use super::hub::title_from;

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
const QUIET_START: Duration = Duration::from_secs(20);
const MISSING_AGENT_CHECKS: u32 = 5;
/// How long a submitted prompt may show no sign of a turn before the
/// adapter presses Enter again: a TUI still settling after launch can take
/// the pasted text but drop the Enter that follows it.
const SUBMIT_GRACE: Duration = Duration::from_secs(5);

/// Which coding-agent TUI each session runs.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, clap::ValueEnum)]
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
    let adapter = Arc::new(Adapter {
        out: out_tx,
        pending: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(0),
        sessions: Mutex::new(HashMap::new()),
        herdr: herdr
            .as_ref()
            .map(|herdr| HerdrCli::new(&herdr.bin, herdr.workspace_id.clone())),
        options,
        home: environment::Home::new().and_then(|home| home.value().map(PathBuf::from)),
        claimed: Mutex::new(std::collections::HashSet::new()),
    });

    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Some(line) = lines.next_line().await? {
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let id = message.get("id").filter(|id| !id.is_null()).cloned();
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        match (message.get("method").and_then(Value::as_str), id) {
            (Some(method), Some(id)) => {
                let adapter = adapter.clone();
                let method = method.to_owned();
                tokio::spawn(async move {
                    let result = adapter.request(&method, params).await;
                    adapter.respond(id, result);
                });
            }
            (Some("session/cancel"), None) => adapter.cancel(&params),
            (Some(_), None) => {}
            (None, Some(id)) => adapter.answered(&id, message),
            (None, None) => {}
        }
    }
    drop(adapter);
    let _ = writer.await;
    Ok(())
}

struct Adapter {
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
    live: tokio::sync::Mutex<Option<Live>>,
    cancel: Mutex<Option<CancellationToken>>,
}

/// A session's running TUI.
struct Live {
    session: String,
    cwd: PathBuf,
    started: std::time::SystemTime,
    name: String,
    model: String,
    log: Transcript,
    path: Option<PathBuf>,
    offset: u64,
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
        rx.await.ok()
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

    fn cancel(&self, params: &Value) {
        if let Ok(session) = self.session(params)
            && let Some(cancel) = lock(&session.cancel).as_ref()
        {
            cancel.cancel();
        }
    }

    async fn request(self: &Arc<Self>, method: &str, params: Value) -> Result<Value, RpcError> {
        match method {
            "initialize" => Ok(json!({
                "protocolVersion": 1,
                "agentCapabilities": {
                    "loadSession": false,
                    "promptCapabilities": {"image": false, "audio": false, "embeddedContext": false},
                },
                "authMethods": [],
                "agentInfo": {"name": "macrod-herdr", "version": env!("CARGO_PKG_VERSION")},
            })),
            "session/new" => Ok(self.new_session(&params)),
            "session/set_config_option" => {
                let session = self.session(&params)?;
                let config = params.get("configId").and_then(Value::as_str);
                let value = params.get("value").and_then(Value::as_str);
                match (config, value) {
                    (Some(MODEL_CONFIG_ID), Some(model))
                        if self
                            .options
                            .kind
                            .models()
                            .iter()
                            .any(|(id, _)| *id == model) =>
                    {
                        model.clone_into(&mut lock(&session.model));
                        Ok(json!({"configOptions": config_options(self.options.kind, model)}))
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

    fn new_session(&self, params: &Value) -> Value {
        let id = uuid::Uuid::new_v4().to_string();
        let cwd = params
            .get("cwd")
            .and_then(Value::as_str)
            .map_or_else(|| PathBuf::from("."), PathBuf::from);
        let mcp_servers = params
            .get("mcpServers")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        lock(&self.sessions).insert(
            id.clone(),
            Arc::new(Session {
                id: id.clone(),
                cwd,
                mcp_servers,
                model: Mutex::new(DEFAULT_MODEL.to_owned()),
                live: tokio::sync::Mutex::new(None),
                cancel: Mutex::new(None),
            }),
        );
        json!({"sessionId": id, "configOptions": config_options(self.options.kind, DEFAULT_MODEL)})
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

        let mut guard = session.live.lock().await;
        if guard.is_none() {
            *guard = Some(self.launch(herdr, session, text).await?);
        }
        let Some(live) = guard.as_mut() else {
            return Err(RpcError::internal("the Claude Code window did not start"));
        };

        let model = lock(&session.model).clone();
        if model != live.model && self.options.kind == TuiAgent::Claude {
            herdr
                .prompt_agent(&live.name, &format!("/model {model}"))
                .await?;
            live.model = model;
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        // Anything already in the transcript belongs to earlier turns.
        for event in self.drain(live) {
            if let LogEvent::Update(update) = event {
                self.notify_update(&session.id, update);
            }
        }
        herdr.prompt_agent(&live.name, text).await?;
        let outcome = self.follow(herdr, session, live, &cancel).await;
        if outcome.is_err() {
            *guard = None;
        }
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
        let window = herdr
            .open_window(&session.cwd, &label, !self.options.no_focus)
            .await?;
        // The tab's shell must reach its prompt before an agent can start.
        tokio::time::sleep(Duration::from_millis(800)).await;

        let model = lock(&session.model).clone();
        let mut args = Vec::new();
        if model != DEFAULT_MODEL {
            args.extend(["--model".to_owned(), model.clone()]);
        }
        if kind == TuiAgent::Claude {
            args.extend(["--session-id".to_owned(), session.id.clone()]);
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
        args.extend(self.options.agent_args.iter().cloned());
        let name = agent_name(&session.id);
        let started = std::time::SystemTime::now();
        herdr
            .start_agent(&name, kind.herdr_kind(), &window.pane_id, &args)
            .await?;
        tracing::info!(
            session = %session.id,
            pane = %window.pane_id,
            agent = kind.herdr_kind(),
            "agent started in herdr"
        );
        Ok(Live {
            session: session.id.clone(),
            cwd: session.cwd.clone(),
            started,
            name,
            model,
            log: self.options.kind.log(),
            path: None,
            offset: 0,
        })
    }

    /// Hand Claude Code the MCP servers Macro gave the session, in a file
    /// only this user can read: the entries carry session credentials.
    fn write_mcp_config(&self, session: &Session) -> Result<Option<PathBuf>, RpcError> {
        let servers = claude_mcp_servers(&session.mcp_servers);
        if servers.is_empty() {
            return Ok(None);
        }
        let dir = std::env::temp_dir().join("macrod-herdr");
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
        let mut resubmitted = false;
        loop {
            tokio::select! {
                () = cancel.cancelled() => {
                    herdr.send_keys(&live.name, &["esc"]).await?;
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    if self.options.kind == TuiAgent::Claude {
                        // Claude Code puts an interrupted prompt back in its
                        // input box; left there, the next prompt is appended
                        // to it. One Ctrl+C clears the box (two would quit).
                        herdr.send_keys(&live.name, &["ctrl+c"]).await?;
                    }
                    self.forward(session, live, &mut open_tool);
                    return Ok("cancelled");
                }
                () = tokio::time::sleep(POLL) => {}
            }
            let (moved, ended) = self.forward(session, live, &mut open_tool);
            active |= moved;
            if let Some(stop) = ended {
                return Ok(stop);
            }

            ticks += 1;
            if !ticks.is_multiple_of(STATUS_EVERY) {
                continue;
            }
            let status = match herdr.agent_info(&live.name).await {
                Ok(info) => {
                    missing = 0;
                    if live.path.is_none() {
                        live.path = self.locate(live, info.session_id.as_deref());
                    }
                    info.status
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
                        let current = generation.fetch_add(1, Ordering::SeqCst) + 1;
                        self.ask_permission(session, live, open_tool.clone(), current, &generation);
                    }
                }
                "idle" | "done" if !active && !resubmitted && started.elapsed() >= SUBMIT_GRACE => {
                    resubmitted = true;
                    tracing::warn!(agent = %live.name, "prompt shows no activity; pressing Enter again");
                    herdr.send_keys(&live.name, &["enter"]).await?;
                }
                "idle" | "done" => {
                    settled += 1;
                    if settled >= SETTLED_CHECKS && (active || started.elapsed() > QUIET_START) {
                        self.forward(session, live, &mut open_tool);
                        return Ok("end_turn");
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
    ) -> (bool, Option<&'static str>) {
        let mut moved = false;
        let mut ended = None;
        for event in self.drain(live) {
            match event {
                LogEvent::Update(update) => {
                    moved = true;
                    // Codex logs a command only once it has run, so its log
                    // never names the call a permission dialog is about.
                    if self.options.kind == TuiAgent::Claude {
                        track_open_tool(open_tool, &update);
                    }
                    self.notify_update(&session.id, update);
                }
                LogEvent::TurnEnded(stop) => ended = Some(stop),
            }
        }
        (moved, ended)
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
            let (tool_id, title) = match tool {
                Some(tool) => tool,
                None => {
                    let screen = herdr.read_agent(&name).await.unwrap_or_default();
                    (
                        format!("herdr-permission-{generation}"),
                        permission_title(kind, &screen),
                    )
                }
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
            let allowed = answer
                .as_ref()
                .and_then(|answer| answer.pointer("/result/outcome/optionId"))
                .and_then(Value::as_str)
                == Some("allow");
            let key = if allowed { "enter" } else { "esc" };
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
    fn drain(&self, live: &mut Live) -> Vec<LogEvent> {
        if live.path.is_none() {
            live.path = self.locate(live, None);
        }
        let Some(path) = &live.path else {
            return Vec::new();
        };
        let Ok(mut file) = std::fs::File::open(path) else {
            return Vec::new();
        };
        if file.seek(std::io::SeekFrom::Start(live.offset)).is_err() {
            return Vec::new();
        }
        let mut bytes = Vec::new();
        if file.read_to_end(&mut bytes).is_err() {
            return Vec::new();
        }
        let Some(end) = bytes.iter().rposition(|byte| *byte == b'\n') else {
            return Vec::new();
        };
        live.offset += end as u64 + 1;
        String::from_utf8_lossy(&bytes[..end])
            .lines()
            .flat_map(|line| live.log.entry(line))
            .collect()
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
    json!([{
        "id": MODEL_CONFIG_ID,
        "name": "Model",
        "category": "model",
        "type": "select",
        "currentValue": current,
        "options": kind
            .models()
            .iter()
            .map(|(value, name)| json!({"value": value, "name": name}))
            .collect::<Vec<_>>(),
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

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write as _;
    use std::os::unix::fs::OpenOptionsExt as _;
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?
        .write_all(bytes)
}

#[cfg(test)]
mod test;
