//! Waking the agent: start one turn with a prompt.
//!
//! - [`CommandWaker`] runs a local CLI (e.g. `claude -p`) with the prompt on
//!   stdin and waits for it to exit; the turn is over when the process is.
//! - [`SessionWaker`] prompts a Macro agent session on the agent's own bot,
//!   so the turn is visible in Macro. Its turn is over once the prompt is
//!   delivered; the session keeps working on its own.
//! - [`TypingGuard`] shows the typing indicator while a turn runs.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use chrono::Utc;
use futures::future::BoxFuture;
use tokio::io::AsyncWriteExt as _;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::client::MacroClient;
use crate::error::{Error, Result};
use crate::memory::{append_text, file_safe, write_atomic};

#[cfg(test)]
mod test;

/// One turn to run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Turn {
    /// A short label for logs and file names, e.g. `respond` or `heartbeat`.
    pub label: String,
    /// The conversation it belongs to, if any; [`SessionWaker`] keeps one
    /// session per conversation.
    pub conversation: Option<String>,
    /// The full prompt.
    pub prompt: String,
}

impl Turn {
    /// A turn labelled `label` with this prompt.
    pub fn new(label: impl Into<String>, prompt: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            conversation: None,
            prompt: prompt.into(),
        }
    }

    /// Tie the turn to a conversation.
    pub fn in_conversation(mut self, conversation: impl Into<String>) -> Self {
        self.conversation = Some(conversation.into());
        self
    }
}

/// How a turn went.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnOutcome {
    /// Whether the turn completed successfully.
    pub success: bool,
    /// The turn's log file, if the waker writes one.
    pub log_path: Option<PathBuf>,
    /// A one-line summary (exit status, session id, ...).
    pub detail: String,
}

/// Starts one agent turn. Object safe, so a daemon can pick an
/// implementation at runtime (`Box<dyn Waker>`).
pub trait Waker: Send + Sync {
    /// Run (or start) one turn.
    fn wake(&self, turn: Turn) -> BoxFuture<'_, Result<TurnOutcome>>;
}

/// Runs a CLI per turn with the prompt on stdin.
#[derive(Debug, Clone)]
pub struct CommandWaker {
    program: String,
    args: Vec<String>,
    cwd: PathBuf,
    log_dir: PathBuf,
    timeout: Duration,
    env: Vec<(String, String)>,
}

impl CommandWaker {
    /// Run `program` in `cwd`, writing one log per turn under `log_dir`
    /// plus a summary line in `log_dir/index.log`.
    pub fn new(
        program: impl Into<String>,
        cwd: impl Into<PathBuf>,
        log_dir: impl Into<PathBuf>,
    ) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
            cwd: cwd.into(),
            log_dir: log_dir.into(),
            timeout: Duration::from_secs(30 * 60),
            env: Vec::new(),
        }
    }

    /// Claude Code in print mode: `claude -p --model <model>
    /// --permission-mode auto`.
    pub fn claude(model: &str, cwd: impl Into<PathBuf>, log_dir: impl Into<PathBuf>) -> Self {
        Self::new("claude", cwd, log_dir).args([
            "-p",
            "--model",
            model,
            "--permission-mode",
            "auto",
        ])
    }

    /// Append arguments.
    pub fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.args.extend(args.into_iter().map(Into::into));
        self
    }

    /// Set an environment variable for the process.
    pub fn env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.push((key.into(), value.into()));
        self
    }

    /// Kill the process after this long (default 30 minutes).
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    async fn run(&self, turn: Turn) -> Result<TurnOutcome> {
        tokio::fs::create_dir_all(&self.log_dir)
            .await
            .map_err(|e| Error::io("create", &self.log_dir, e))?;
        let stamp = Utc::now().format("%Y%m%dT%H%M%S%.3fZ");
        let log_path = self
            .log_dir
            .join(format!("{}-{stamp}.log", file_safe(&turn.label)));
        let log = tokio::fs::File::create(&log_path)
            .await
            .map_err(|e| Error::io("create", &log_path, e))?
            .into_std()
            .await;
        let log_err = log
            .try_clone()
            .map_err(|e| Error::io("open", &log_path, e))?;
        let mut child = tokio::process::Command::new(&self.program)
            .args(&self.args)
            .envs(self.env.iter().map(|(k, v)| (k, v)))
            .current_dir(&self.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_err))
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| Error::Wake(format!("could not start {}: {e}", self.program)))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(turn.prompt.as_bytes())
                .await
                .map_err(|e| Error::Wake(format!("could not send the prompt: {e}")))?;
            // Dropping stdin closes it, so the CLI sees end of input.
        }
        let (success, detail) = match tokio::time::timeout(self.timeout, child.wait()).await {
            Ok(Ok(status)) => (status.success(), status.to_string()),
            Ok(Err(e)) => {
                return Err(Error::Wake(format!(
                    "could not wait for {}: {e}",
                    self.program
                )));
            }
            Err(_) => {
                child
                    .kill()
                    .await
                    .inspect_err(|e| tracing::warn!(error = %e, "could not kill a timed-out turn"))
                    .ok();
                (
                    false,
                    format!("timed out after {}s", self.timeout.as_secs()),
                )
            }
        };
        let line = format!(
            "{} {} {} {} {}\n",
            Utc::now().format("%Y-%m-%dT%H:%M:%SZ"),
            turn.label,
            if success { "ok" } else { "failed" },
            detail,
            log_path.display()
        );
        append_text(&self.log_dir.join("index.log"), &line)
            .await
            .inspect_err(|e| tracing::warn!(error = %e, "could not write index.log"))
            .ok();
        Ok(TurnOutcome {
            success,
            log_path: Some(log_path),
            detail,
        })
    }
}

impl Waker for CommandWaker {
    fn wake(&self, turn: Turn) -> BoxFuture<'_, Result<TurnOutcome>> {
        let span = tracing::info_span!(
            "agent_brain.wake",
            waker = "command",
            label = %turn.label,
            conversation = turn.conversation.as_deref(),
        );
        Box::pin(tracing::Instrument::instrument(self.run(turn), span))
    }
}

/// Prompts a Macro agent session on the agent's bot, one session per
/// conversation (persisted in a JSON file so restarts reuse them).
#[derive(Debug)]
pub struct SessionWaker {
    client: MacroClient,
    bot_id: Uuid,
    sessions_path: PathBuf,
    sessions: tokio::sync::Mutex<Option<HashMap<String, Uuid>>>,
}

const DEFAULT_CONVERSATION: &str = "default";

impl SessionWaker {
    /// Prompt sessions on `bot_id`'s runtime; remember them in `sessions_path`.
    pub fn new(client: MacroClient, bot_id: Uuid, sessions_path: impl Into<PathBuf>) -> Self {
        Self {
            client,
            bot_id,
            sessions_path: sessions_path.into(),
            sessions: tokio::sync::Mutex::new(None),
        }
    }

    async fn run(&self, turn: Turn) -> Result<TurnOutcome> {
        let key = turn
            .conversation
            .clone()
            .unwrap_or_else(|| DEFAULT_CONVERSATION.to_owned());
        let mut guard = self.sessions.lock().await;
        if guard.is_none() {
            *guard = Some(self.load().await?);
        }
        let sessions = guard.get_or_insert_with(HashMap::new);
        if let Some(&session_id) = sessions.get(&key) {
            match self
                .client
                .prompt_agent_session(session_id, &turn.prompt)
                .await
            {
                Ok(ack) => return Ok(outcome(session_id, ack.status)),
                // The session is gone; start a fresh one below.
                Err(e) if matches!(e.status(), Some(404 | 410)) => {
                    tracing::info!(session_id = %session_id, "session gone; starting a new one");
                }
                Err(e) => return Err(e),
            }
        }
        let session_id = Uuid::now_v7();
        self.client
            .create_agent_session(session_id, self.bot_id)
            .await?;
        sessions.insert(key, session_id);
        self.save(sessions).await?;
        let ack = self
            .client
            .prompt_agent_session(session_id, &turn.prompt)
            .await?;
        Ok(outcome(session_id, ack.status))
    }

    async fn load(&self) -> Result<HashMap<String, Uuid>> {
        match tokio::fs::read_to_string(&self.sessions_path).await {
            Ok(text) => serde_json::from_str(&text)
                .map_err(|e| Error::json(self.sessions_path.display().to_string(), e)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
            Err(e) => Err(Error::io("read", &self.sessions_path, e)),
        }
    }

    async fn save(&self, sessions: &HashMap<String, Uuid>) -> Result<()> {
        let text =
            serde_json::to_vec_pretty(sessions).map_err(|e| Error::json("the session map", e))?;
        if let Some(dir) = self.sessions_path.parent() {
            tokio::fs::create_dir_all(dir)
                .await
                .map_err(|e| Error::io("create", dir, e))?;
        }
        write_atomic(&self.sessions_path, &text).await
    }
}

fn outcome(session_id: Uuid, status: crate::client::PromptStatus) -> TurnOutcome {
    TurnOutcome {
        success: true,
        log_path: None,
        detail: format!("session {session_id}: prompt {status:?}"),
    }
}

impl Waker for SessionWaker {
    fn wake(&self, turn: Turn) -> BoxFuture<'_, Result<TurnOutcome>> {
        let span = tracing::info_span!(
            "agent_brain.wake",
            waker = "session",
            label = %turn.label,
            conversation = turn.conversation.as_deref(),
            bot_id = %self.bot_id,
        );
        Box::pin(tracing::Instrument::instrument(self.run(turn), span))
    }
}

/// How often to refresh the typing indicator (it expires on its own).
pub const TYPING_REFRESH: Duration = Duration::from_secs(4);
/// Never show typing longer than this, even if a turn hangs.
pub const TYPING_MAX: Duration = Duration::from_secs(10 * 60);

/// Shows "typing" in a channel (or thread) until dropped or stopped.
#[derive(Debug)]
pub struct TypingGuard {
    stop: CancellationToken,
    task: Option<tokio::task::JoinHandle<()>>,
}

impl TypingGuard {
    /// Start typing in `channel_id`, in the thread `thread_id` if given.
    pub fn start(
        client: MacroClient,
        channel_id: impl Into<String>,
        thread_id: Option<String>,
    ) -> Self {
        let stop = CancellationToken::new();
        let token = stop.clone();
        let channel_id = channel_id.into();
        let task = tokio::spawn(async move {
            let deadline = tokio::time::sleep(TYPING_MAX);
            tokio::pin!(deadline);
            loop {
                client
                    .typing(&channel_id, thread_id.as_deref(), true)
                    .await
                    .inspect_err(|e| tracing::debug!(error = %e, "typing indicator failed"))
                    .ok();
                tokio::select! {
                    () = token.cancelled() => break,
                    () = &mut deadline => break,
                    () = tokio::time::sleep(TYPING_REFRESH) => {}
                }
            }
            client
                .typing(&channel_id, thread_id.as_deref(), false)
                .await
                .inspect_err(|e| tracing::debug!(error = %e, "typing stop failed"))
                .ok();
        });
        Self {
            stop,
            task: Some(task),
        }
    }

    /// Stop typing and wait until the indicator is cleared.
    pub async fn stop(mut self) {
        self.stop.cancel();
        if let Some(task) = self.task.take() {
            task.await
                .inspect_err(|e| tracing::debug!(error = %e, "typing task ended abnormally"))
                .ok();
        }
    }
}

impl Drop for TypingGuard {
    fn drop(&mut self) {
        // The task clears the indicator on its own after cancellation.
        self.stop.cancel();
    }
}
