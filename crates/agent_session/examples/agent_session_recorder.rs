//! Record a live agent session as [`Message`]-per-line JSONL fixtures.
//!
//! An ACP client (e.g. Zed) spawns this example as its agent server and
//! speaks ACP over stdio. Internally the process is both sides of an
//! Agent Runtime Protocol connection over a loopback WebSocket:
//!
//! - the service side accepts the runtime connection, records every logical
//!   protocol message crossing the wire, and bridges the connection's ACP
//!   channel to stdio;
//! - a Tokio task stands in for a container, connects its runtime to the
//!   service, announces `acp_ready`, and starts the official Claude Code ACP
//!   adapter (`@agentclientprotocol/claude-agent-acp`) with `npx`.
//!
//! Each ACP session on the connection is recorded to its own file,
//! `~/.agent_runtime_sessions/<session-id>.jsonl`, one JSON object per line:
//! a timestamp flattened together with this crate's own [`Message`]
//! serialization, so each line parses straight back into [`Message`]:
//!
//! ```text
//! {"ts": "2026-08-03T14:22:07.123Z", "direction": "to_server" | "to_runtime", "content": <envelope>}
//! ```
//!
//! One connection multiplexes many sessions (an ACP client like Zed spawns
//! the agent server once and opens every session over it), so lines are
//! routed by the session they belong to: `params.sessionId` where present,
//! and JSON-RPC request ids otherwise — a response is attributed to the
//! session of the request it answers, and `session/new` only reveals its
//! session in the response. Connection-level traffic that belongs to no
//! session (the `acp_ready` event, the `initialize` handshake) is copied
//! into every session file so each recording stands alone. A connection that
//! never opens a session records nothing; a session resumed by a later
//! process appends to its existing file.
//!
//! Prerequisites:
//!
//! - Node.js and `npx` must be installed;
//! - Claude Code credentials: either a subscription login (`claude /login`)
//!   or `ANTHROPIC_API_KEY` in the environment. The API key takes precedence
//!   over the subscription login when both are present.
//!
//! Install the recorder to `~/.cargo/bin` (`--locked` keeps the workspace
//! lockfile's dependency versions, which the pinned toolchain requires), then
//! point an ACP client at the installed binary:
//!
//! ```text
//! cargo install --locked --path crates/agent_session --example agent_session_recorder
//! ```
//!
//! Zed `settings.json` (the shell resolves the binary from `$HOME`, so no
//! hardcoded paths; the `env -u` strips a stray API key from the environment
//! so the session uses the subscription login):
//!
//! ```text
//! "agent_servers": {
//!   "Recorded Claude": {
//!     "type": "custom",
//!     "command": "/bin/bash",
//!     "args": [
//!       "-c",
//!       "exec env -u ANTHROPIC_API_KEY \"$HOME/.cargo/bin/agent_session_recorder\""
//!     ]
//!   }
//! }
//! ```
//!
//! All diagnostics go to stderr: stdout carries the ACP stream.

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::error::Error;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use agent_client_protocol::{AcpAgent, Agent, Client, ConnectTo, Stdio};
use agent_runtime_protocol::domain::channel::Channel;
use agent_runtime_protocol::domain::connection::{
    RuntimeConnection, ServerChannel, ServerConnection,
};
use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToRuntimeMessage, ToServerMessage};
use agent_runtime_protocol::outbound::websocket::{ServerTransport, connect_runtime};
use agent_session::domain::model::Message;
use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

#[cfg(test)]
#[path = "agent_session_recorder/test.rs"]
mod test;

type AnyError = Box<dyn Error + Send + Sync>;

const CLAUDE_AGENT_ACP: &str = "@agentclientprotocol/claude-agent-acp@0.64.2";

#[tokio::main]
async fn main() -> Result<(), AnyError> {
    let dir = recordings_dir(&std::env::home_dir().ok_or("cannot determine home directory")?);
    let (sink, lines) = mpsc::unbounded_channel();
    let writer = tokio::spawn(run_writer(dir.clone(), lines));

    let carrier: Arc<ServerTransport<ToRuntimeMessage, ToServerMessage>> =
        Arc::new(ServerTransport::new());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let app = Arc::clone(&carrier).into_router();
    let websocket_handle = tokio::spawn(async move { axum::serve(listener, app).await });
    eprintln!("recorder: service listening on ws://{address}");

    let mut container = tokio::spawn(run_container(format!("ws://{address}")));
    let incoming = accept_runtime(&carrier, &mut container).await?;
    eprintln!(
        "recorder: runtime connected, recording sessions under {}",
        dir.display()
    );

    let (service, acp) = ServerConnection::connect(record_channel(incoming, sink), ());

    // Bridge the ACP client on stdio to this connection's agent. The client
    // drives the whole session; this future completes when it closes stdio.
    let bridge = ConnectTo::<Agent>::connect_to(Stdio::new(), acp);
    tokio::pin!(bridge);
    let result: Result<(), AnyError> = tokio::select! {
        result = &mut bridge => {
            container.abort();
            let _ = container.await;
            result.map_err(Into::into)
        }
        container_result = &mut container => Err(container_error(container_result)),
    };

    // Tear the connection down, then let the writer drain what was recorded.
    drop(service);
    websocket_handle.abort();
    match writer.await {
        Ok(Ok(())) => eprintln!("recorder: session recordings saved under {}", dir.display()),
        Ok(Err(error)) => eprintln!("recorder: writing the recordings failed: {error}"),
        Err(error) => eprintln!("recorder: recording writer panicked: {error}"),
    }
    result
}

/// The directory holding per-session recordings for the user whose home
/// directory is `home`.
fn recordings_dir(home: &Path) -> PathBuf {
    home.join(".agent_runtime_sessions")
}

/// Where the session identified by `session_id` is recorded under `dir`.
///
/// The id is minted by the agent (a UUID in practice); anything outside a
/// conservative filename alphabet maps to `_` so an exotic id cannot name a
/// path outside `dir`.
fn session_recording_path(dir: &Path, session_id: &str) -> PathBuf {
    let safe: String = session_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    dir.join(format!("{safe}.jsonl"))
}

/// One recorded line's destination.
#[derive(Debug, PartialEq)]
enum Append {
    /// A connection-level line: appended to every open recording and copied
    /// to the front of any recording opened later, so each file stands alone.
    Shared(String),
    /// A line belonging to one session's recording.
    Session { session_id: String, line: String },
}

/// Where the response to an in-flight request belongs.
enum Pending {
    /// The request named its session; the response follows it there.
    Session(String),
    /// The request named no session (`initialize`, `session/new`, ...); its
    /// line is held back until the response shows whether it minted one.
    Unattributed { request_line: String },
}

/// Routes recorded JSONL lines to per-session recordings.
///
/// Most ACP traffic names its session in `params.sessionId`. Responses never
/// do, so requests register their JSON-RPC id and responses are attributed
/// by looking that id back up. Ids are scoped by the direction of the
/// request: the two peers' id spaces are independent, so an id alone is
/// ambiguous.
#[derive(Default)]
struct SessionRouter {
    /// `"<issuer direction>:<id>"` of each in-flight request, mapped to
    /// where its response belongs.
    pending: HashMap<String, Pending>,
}

impl SessionRouter {
    /// Decide where `line` (one serialized [`RecordedLine`]) is appended.
    ///
    /// A request that names no session yields nothing until its response
    /// arrives; the pair is then routed together.
    fn route(&mut self, line: String) -> Vec<Append> {
        let value: serde_json::Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            // Lines come from record_line, so this cannot happen; shared is
            // the destination that never loses data.
            Err(_) => return vec![Append::Shared(line)],
        };
        let direction = value["direction"].as_str().unwrap_or_default().to_owned();
        let content = &value["content"];
        let method = content["method"].as_str();
        let id = match &content["id"] {
            serde_json::Value::Null => None,
            id => Some(id.to_string()),
        };
        let session_id = content["params"]["sessionId"].as_str().map(str::to_owned);

        match (method, id) {
            // A request: remember where its response belongs.
            (Some(_), Some(id)) => match session_id {
                Some(session_id) => {
                    self.pending.insert(
                        format!("{direction}:{id}"),
                        Pending::Session(session_id.clone()),
                    );
                    vec![Append::Session { session_id, line }]
                }
                None => {
                    self.pending.insert(
                        format!("{direction}:{id}"),
                        Pending::Unattributed { request_line: line },
                    );
                    vec![]
                }
            },
            // A notification.
            (Some(_), None) => match session_id {
                Some(session_id) => vec![Append::Session { session_id, line }],
                None => vec![Append::Shared(line)],
            },
            // A response: attribute it via the request that caused it, which
            // traveled in the opposite direction.
            (None, Some(id)) => {
                let issuer = opposite(&direction);
                match self.pending.remove(&format!("{issuer}:{id}")) {
                    Some(Pending::Session(session_id)) => {
                        vec![Append::Session { session_id, line }]
                    }
                    Some(Pending::Unattributed { request_line }) => {
                        match content["result"]["sessionId"].as_str() {
                            // The request minted a session (session/new);
                            // both lines open its recording.
                            Some(minted) => vec![
                                Append::Session {
                                    session_id: minted.to_owned(),
                                    line: request_line,
                                },
                                Append::Session {
                                    session_id: minted.to_owned(),
                                    line,
                                },
                            ],
                            None => vec![Append::Shared(request_line), Append::Shared(line)],
                        }
                    }
                    None => vec![Append::Shared(line)],
                }
            }
            // Not JSON-RPC at all, e.g. the acp_ready system event.
            (None, None) => vec![Append::Shared(line)],
        }
    }

    /// Give back request lines still waiting on a response — e.g. when the
    /// connection closes mid-request — so they are not lost. Sorted by
    /// pending key for determinism.
    fn drain(&mut self) -> Vec<Append> {
        let mut pending: Vec<_> = std::mem::take(&mut self.pending).into_iter().collect();
        pending.sort_by(|(a, _), (b, _)| a.cmp(b));
        pending
            .into_iter()
            .filter_map(|(_, entry)| match entry {
                Pending::Session(_) => None,
                Pending::Unattributed { request_line } => Some(Append::Shared(request_line)),
            })
            .collect()
    }
}

/// The opposite of a recorded `direction` value.
fn opposite(direction: &str) -> &'static str {
    match direction {
        "to_server" => "to_runtime",
        _ => "to_server",
    }
}

/// Route recorded lines to per-session files until every sink handle drops.
///
/// Flushes after every line so a session killed mid-run keeps its data.
async fn run_writer(
    dir: PathBuf,
    mut lines: mpsc::UnboundedReceiver<String>,
) -> std::io::Result<()> {
    tokio::fs::create_dir_all(&dir).await?;
    let mut router = SessionRouter::default();
    // Connection-level lines recorded so far, copied into each new recording.
    let mut shared: Vec<String> = Vec::new();
    let mut recordings: HashMap<String, tokio::fs::File> = HashMap::new();

    while let Some(line) = lines.recv().await {
        let appends = router.route(line);
        append_lines(&dir, appends, &mut shared, &mut recordings).await?;
    }
    let leftovers = router.drain();
    append_lines(&dir, leftovers, &mut shared, &mut recordings).await
}

/// Apply routed appends, opening a session's recording on its first line.
///
/// A recording opens in append mode: a session resumed by a later process
/// continues its existing file. Each newly opened recording starts with a
/// copy of the connection-level lines seen so far.
async fn append_lines(
    dir: &Path,
    appends: Vec<Append>,
    shared: &mut Vec<String>,
    recordings: &mut HashMap<String, tokio::fs::File>,
) -> std::io::Result<()> {
    for append in appends {
        match append {
            Append::Shared(line) => {
                for file in recordings.values_mut() {
                    write_line(file, &line).await?;
                }
                shared.push(line);
            }
            Append::Session { session_id, line } => {
                let file = match recordings.entry(session_id) {
                    Entry::Occupied(entry) => entry.into_mut(),
                    Entry::Vacant(entry) => {
                        let path = session_recording_path(dir, entry.key());
                        let mut file = tokio::fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&path)
                            .await?;
                        for line in shared.iter() {
                            write_line(&mut file, line).await?;
                        }
                        eprintln!(
                            "recorder: session {} recording to {}",
                            entry.key(),
                            path.display()
                        );
                        entry.insert(file)
                    }
                };
                write_line(file, &line).await?;
            }
        }
    }
    Ok(())
}

/// Append one line to `file` and flush it.
async fn write_line(file: &mut tokio::fs::File, line: &str) -> std::io::Result<()> {
    file.write_all(line.as_bytes()).await?;
    file.write_all(b"\n").await?;
    file.flush().await
}

/// Interpose a recording tap on the service side of a logical connection.
///
/// Every message crossing the channel is appended to `sink` as one JSONL
/// line before being forwarded unchanged. Recording is best-effort: a
/// message that fails to serialize is reported on stderr and forwarded
/// anyway, and a closed sink never tears down the session.
fn record_channel(inner: ServerChannel, sink: mpsc::UnboundedSender<String>) -> ServerChannel {
    let (outer, bridge) = Channel::duplex();
    let Channel {
        tx: inner_tx,
        rx: mut inner_rx,
    } = inner;
    let Channel {
        tx: bridge_tx,
        rx: mut bridge_rx,
    }: Channel<ToServerMessage, ToRuntimeMessage> = bridge;

    let to_runtime_sink = sink.clone();
    tokio::spawn(async move {
        while let Some(message) = bridge_rx.recv().await {
            record(&to_runtime_sink, &Message::ToRuntime(message.clone()));
            if inner_tx.send(message).is_err() {
                break;
            }
        }
    });
    tokio::spawn(async move {
        while let Some(message) = inner_rx.recv().await {
            record(&sink, &Message::ToServer(message.clone()));
            if bridge_tx.send(message).is_err() {
                break;
            }
        }
    });

    outer
}

/// One recorded JSONL line: a timestamp flattened alongside [`Message`]'s
/// own `direction`/`content` serialization.
#[derive(Serialize)]
struct RecordedLine<'a> {
    ts: String,
    #[serde(flatten)]
    message: &'a Message,
}

fn record(sink: &mpsc::UnboundedSender<String>, message: &Message) {
    match record_line(message) {
        Ok(line) => {
            let _ = sink.send(line);
        }
        Err(error) => eprintln!("recorder: dropping unserializable message: {error}"),
    }
}

fn record_line(message: &Message) -> serde_json::Result<String> {
    serde_json::to_string(&RecordedLine {
        ts: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        message,
    })
}

async fn accept_runtime(
    carrier: &ServerTransport<ToRuntimeMessage, ToServerMessage>,
    container: &mut tokio::task::JoinHandle<Result<(), AnyError>>,
) -> Result<ServerChannel, AnyError> {
    tokio::select! {
        incoming = carrier.accept() => incoming
            .ok_or_else(|| "container disconnected before connecting".into()),
        result = &mut *container => Err(container_error(result)),
    }
}

fn container_error(result: Result<Result<(), AnyError>, tokio::task::JoinError>) -> AnyError {
    match result {
        Ok(Ok(())) => "container exited unexpectedly".into(),
        Ok(Err(error)) => error,
        Err(error) => Box::new(error),
    }
}

async fn run_container(websocket_url: String) -> Result<(), AnyError> {
    let (stream, _response) = tokio_tungstenite::connect_async(websocket_url).await?;
    let channel = connect_runtime::<ToServerMessage, ToRuntimeMessage, _>(stream);
    let (runtime, acp) = RuntimeConnection::connect(channel);
    // Announce readiness over the wire like a real Agent Runtime would, so
    // the recording contains the acp_ready event that production logs carry.
    runtime.system_event(SystemEvent::AcpReady)?;

    let claude_code = AcpAgent::from_args(["npx", "-y", CLAUDE_AGENT_ACP])?;
    ConnectTo::<Client>::connect_to(claude_code, acp)
        .await
        .map_err(Into::into)
}
