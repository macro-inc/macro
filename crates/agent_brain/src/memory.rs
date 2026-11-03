//! The agent's state directory: where history, queues, logs, and notes live,
//! plus bounded JSONL helpers and log retention.
//!
//! Layout under the root (all created by [`StateDir::ensure`]):
//!
//! ```text
//! prompts/relevance.json   relevance questions the agent tunes (Jev)
//! prompts/respond.md       instructions for replying to messages
//! prompts/heartbeat.md     instructions for proactive heartbeat turns
//! state/notes.md           the agent's working notes
//! state/history/<conv>.jsonl  recent messages per conversation
//! state/queue/             pending batches (see crate::queue)
//! state/sessions.json      conversation -> agent session (SessionWaker)
//! log/                     per-turn logs, index.log, decisions, reviews
//! ```

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use chrono::{DateTime, Utc};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt as _;

use crate::client::ChannelDetail;
use crate::error::{Error, Result};
use crate::events::MessagePosted;

#[cfg(test)]
mod test;

/// Paths of the agent's state directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StateDir {
    root: PathBuf,
}

impl StateDir {
    /// A state directory rooted at `root`.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// Create every directory of the layout.
    pub async fn ensure(&self) -> Result<()> {
        for dir in [
            self.root.join("prompts"),
            self.history_dir(),
            self.queue_dir(),
            self.log_dir(),
        ] {
            tokio::fs::create_dir_all(&dir)
                .await
                .map_err(|e| Error::io("create", dir, e))?;
        }
        Ok(())
    }

    /// The root.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The relevance file the agent tunes (see [`crate::relevance`]).
    pub fn relevance_path(&self) -> PathBuf {
        self.root.join("prompts/relevance.json")
    }

    /// Instructions for answering messages.
    pub fn respond_prompt_path(&self) -> PathBuf {
        self.root.join("prompts/respond.md")
    }

    /// Instructions for heartbeat turns.
    pub fn heartbeat_prompt_path(&self) -> PathBuf {
        self.root.join("prompts/heartbeat.md")
    }

    /// The agent's working notes.
    pub fn notes_path(&self) -> PathBuf {
        self.root.join("state/notes.md")
    }

    /// Per-conversation message history.
    pub fn history_dir(&self) -> PathBuf {
        self.root.join("state/history")
    }

    /// One conversation's history file.
    pub fn history_path(&self, conversation: &str) -> PathBuf {
        self.history_dir()
            .join(format!("{}.jsonl", file_safe(conversation)))
    }

    /// Queue files (see [`crate::queue`]).
    pub fn queue_dir(&self) -> PathBuf {
        self.root.join("state/queue")
    }

    /// Conversation-to-session map for [`crate::wake::SessionWaker`].
    pub fn sessions_path(&self) -> PathBuf {
        self.root.join("state/sessions.json")
    }

    /// Logs.
    pub fn log_dir(&self) -> PathBuf {
        self.root.join("log")
    }

    /// Every relevance decision, one JSON line each.
    pub fn decisions_log(&self) -> PathBuf {
        self.log_dir().join("decisions.jsonl")
    }

    /// The agent's own grading of relevance decisions, one JSON line each:
    /// `{"message_id","jev_said_relevant","actually_relevant","why"}`.
    pub fn jev_review_log(&self) -> PathBuf {
        self.log_dir().join("jev-review.jsonl")
    }

    /// Items whose turn finished, one JSON line each.
    pub fn handled_log(&self) -> PathBuf {
        self.log_dir().join("handled.jsonl")
    }
}

/// Replace anything but `[A-Za-z0-9._-]` so an id is a safe file name.
pub fn file_safe(id: &str) -> String {
    let safe: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if safe.is_empty() || safe.chars().all(|c| c == '.') {
        format!("_{safe}")
    } else {
        safe
    }
}

/// Append one value as a JSON line, creating the file and its directory.
pub async fn append_jsonl(path: &Path, value: &impl Serialize) -> Result<()> {
    let mut line =
        serde_json::to_string(value).map_err(|e| Error::json(path.display().to_string(), e))?;
    line.push('\n');
    append_text(path, &line).await
}

/// Append raw text, creating the file and its directory.
pub async fn append_text(path: &Path, text: &str) -> Result<()> {
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| Error::io("create", dir, e))?;
    }
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
        .map_err(|e| Error::io("open", path, e))?;
    file.write_all(text.as_bytes())
        .await
        .map_err(|e| Error::io("append to", path, e))?;
    file.flush().await.map_err(|e| Error::io("flush", path, e))
}

/// Every JSON line of a file, skipping blank and undecodable lines. A
/// missing file is empty.
pub async fn read_jsonl<T: DeserializeOwned>(path: &Path) -> Result<Vec<T>> {
    let text = match tokio::fs::read_to_string(path).await {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(Error::io("read", path, e)),
    };
    Ok(text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            serde_json::from_str(line)
                .inspect_err(|e| tracing::warn!(error = %e, path = %path.display(), "skipping bad JSON line"))
                .ok()
        })
        .collect())
}

/// The last `n` JSON lines of a file, oldest first.
pub async fn tail_jsonl<T: DeserializeOwned>(path: &Path, n: usize) -> Result<Vec<T>> {
    let mut all = read_jsonl(path).await?;
    let start = all.len().saturating_sub(n);
    Ok(all.split_off(start))
}

/// Keep only the newest `keep` lines of a file once it exceeds `2 * keep`
/// (so trimming is rare). Returns whether it trimmed. A missing file is fine.
pub async fn trim_lines(path: &Path, keep: usize) -> Result<bool> {
    let text = match tokio::fs::read_to_string(path).await {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(Error::io("read", path, e)),
    };
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() <= keep.saturating_mul(2) {
        return Ok(false);
    }
    let mut kept = lines[lines.len() - keep..].join("\n");
    if !kept.is_empty() {
        kept.push('\n');
    }
    write_atomic(path, kept.as_bytes()).await?;
    Ok(true)
}

/// Write a file via a temporary sibling and a rename, so readers never see
/// it half-written.
pub async fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
    ));
    tokio::fs::write(&tmp, bytes)
        .await
        .map_err(|e| Error::io("write", &tmp, e))?;
    tokio::fs::rename(&tmp, path)
        .await
        .map_err(|e| Error::io("replace", path, e))
}

/// A message as the agent remembers it: in history files, queues, and
/// prompts. Kept on the agent's own disk only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MessageRecord {
    /// Message id.
    pub id: String,
    /// The channel it was posted in.
    pub channel_id: String,
    /// The channel's display name.
    #[serde(default)]
    pub channel: String,
    /// The conversation root (`id` for a root message).
    pub root: String,
    /// The thread root for a reply.
    #[serde(default)]
    pub thread: Option<String>,
    /// Whether the channel is a direct message (answer top level there).
    #[serde(default)]
    pub dm: bool,
    /// The author's id.
    pub sender_id: String,
    /// When it was posted.
    pub at: DateTime<Utc>,
    /// The Markdown body.
    pub text: String,
    /// Whether it mentions the agent.
    #[serde(default)]
    pub mentions_me: bool,
    /// The relevance probabilities that queued it, if any.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub probabilities: BTreeMap<String, f64>,
}

impl MessageRecord {
    /// Record a posted message seen in `channel`, from `me`'s point of view.
    pub fn from_posted(message: &MessagePosted, channel: &ChannelDetail, me: &str) -> Self {
        Self {
            id: message.message_id.clone(),
            channel_id: channel.channel_id.clone(),
            channel: channel.channel_name.clone(),
            root: message
                .thread_id
                .clone()
                .unwrap_or_else(|| message.root_id.clone()),
            thread: message.thread_id.clone(),
            dm: channel.is_direct_message(),
            sender_id: message.sender.0.clone(),
            at: message.created_at,
            text: message.content.clone(),
            mentions_me: message.mentions(me),
            probabilities: BTreeMap::new(),
        }
    }
}

/// One conversation's recent messages, bounded to `max_lines`.
#[derive(Debug, Clone)]
pub struct History {
    path: PathBuf,
    max_lines: usize,
}

impl History {
    /// History in `path`, keeping at least the newest `max_lines` entries.
    pub fn new(path: impl Into<PathBuf>, max_lines: usize) -> Self {
        Self {
            path: path.into(),
            max_lines: max_lines.max(1),
        }
    }

    /// Append an entry, trimming old ones once the file doubles its bound.
    pub async fn append(&self, entry: &impl Serialize) -> Result<()> {
        append_jsonl(&self.path, entry).await?;
        trim_lines(&self.path, self.max_lines).await.map(drop)
    }

    /// The newest `n` entries, oldest first.
    pub async fn recent<T: DeserializeOwned>(&self, n: usize) -> Result<Vec<T>> {
        tail_jsonl(&self.path, n).await
    }
}

/// Retention for [`prune`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PruneOptions {
    /// Delete per-turn `*.log` files older than this.
    pub log_age: Duration,
    /// Keep this many lines of each `log/*.jsonl` and `log/index.log`.
    pub log_lines: usize,
    /// Keep this many lines of each history file.
    pub history_lines: usize,
}

impl Default for PruneOptions {
    fn default() -> Self {
        Self {
            log_age: Duration::from_secs(14 * 24 * 3600),
            log_lines: 5000,
            history_lines: 200,
        }
    }
}

/// What [`prune`] removed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PruneReport {
    /// Old per-turn logs deleted.
    pub logs_deleted: usize,
    /// Files trimmed to their line bound.
    pub files_trimmed: usize,
}

/// Keep the state directory bounded so the daemon can run forever.
pub async fn prune(state: &StateDir, options: PruneOptions) -> Result<PruneReport> {
    let mut report = PruneReport::default();
    let now = SystemTime::now();
    for path in list_dir(&state.log_dir()).await? {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if name.ends_with(".jsonl") || name == "index.log" {
            report.files_trimmed += usize::from(trim_lines(&path, options.log_lines).await?);
        } else if name.ends_with(".log") {
            let modified = tokio::fs::metadata(&path)
                .await
                .and_then(|m| m.modified())
                .map_err(|e| Error::io("inspect", &path, e))?;
            if now.duration_since(modified).unwrap_or_default() > options.log_age {
                tokio::fs::remove_file(&path)
                    .await
                    .map_err(|e| Error::io("delete", &path, e))?;
                report.logs_deleted += 1;
            }
        }
    }
    for path in list_dir(&state.history_dir()).await? {
        if path.extension().is_some_and(|e| e == "jsonl") {
            report.files_trimmed += usize::from(trim_lines(&path, options.history_lines).await?);
        }
    }
    Ok(report)
}

/// The files directly inside `dir`; a missing directory is empty.
pub(crate) async fn list_dir(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut entries = match tokio::fs::read_dir(dir).await {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(Error::io("list", dir, e)),
    };
    let mut paths = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| Error::io("list", dir, e))?
    {
        if entry.file_type().await.is_ok_and(|t| t.is_file()) {
            paths.push(entry.path());
        }
    }
    paths.sort();
    Ok(paths)
}
