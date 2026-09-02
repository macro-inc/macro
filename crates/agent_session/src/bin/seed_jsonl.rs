//! Seed an agent session into Postgres from a recorded JSONL session.
//!
//! The sibling [`fold_jsonl`] binary in `agent_fold` folds a recording in
//! memory and prints it; this one persists the same recording so the session
//! can be read back through the ordinary service - useful for putting a real
//! transcript in front of the UI without running a container.
//!
//! Frames go in through [`LiveSessionLogWriter`] rather than the log repo,
//! because that is the writer a live session's actor uses: it carries an
//! `agent_fold` machine from frame to frame instead of refolding the stored
//! log on each one, so a recording of n frames folds n entries rather than
//! n^2 of them.
//!
//! Recordings are the ones written by the `agent_session_recorder` example to
//! `~/.agent_runtime_sessions/<session-id>.jsonl`: one JSON object per line,
//! carrying this crate's [`Message`] serialization plus a recorder timestamp
//! that is ignored here.
//!
//! ```text
//! {"ts": "...", "direction": "to_server" | "to_runtime", "content": <envelope>}
//! ```
//!
//! ```sh
//! cargo run -p agent_session --bin seed_jsonl -- \
//!     ~/.agent_runtime_sessions/<id>.jsonl \
//!     --database-url postgres://user:password@localhost:5432/macrodb
//! ```
//!
//! [`fold_jsonl`]: https://docs.rs/agent_fold

use agent_session::domain::model::{
    AgentSessionId, AgentSessionLog, CreateAgentSessionParams, Message,
};
use agent_session::domain::ports::{AgentSessionLogWriter, AgentSessionRepo, NoOpRealtime};
use agent_session::domain::service::LiveSessionLogWriter;
use agent_session::outbound::postgres::PgAgentSessionRepo;
use bots::domain::models::BotId;
use clap::Parser;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::Deserialize;
use sqlx::postgres::PgPoolOptions;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, Instant};

/// The `Macro Coder` system bot, seeded by migration, which owns agent
/// sessions unless the caller names a different bot.
const MACRO_CODER_BOT_ID: &str = "00000000-0000-0000-0000-00000000a9e7";

/// Seed an agent session into Postgres from a recorded JSONL session.
#[derive(Parser)]
struct Args {
    /// Path to a session recording, e.g. ~/.agent_runtime_sessions/<id>.jsonl
    recording: PathBuf,

    /// Postgres the session is written to.
    #[arg(
        short,
        long,
        default_value = "postgres://user:password@localhost:5432/macrodb"
    )]
    database_url: String,

    /// User who owns the dedicated agent channel the session creates.
    #[arg(long, default_value = "macro|dev@macro.com")]
    owner: String,

    /// Bot the session runs as.
    #[arg(long, default_value = MACRO_CODER_BOT_ID)]
    bot_id: Uuid,

    /// Model slug recorded on the session.
    #[arg(long, default_value = "claude-opus-5")]
    model: String,

    /// Harness slug recorded on the session.
    #[arg(long, default_value = "claude-code")]
    harness: String,

    /// Repository the session is nominally working in.
    #[arg(long, default_value = "https://github.com/macro/cloud-storage")]
    repo_url: String,

    /// Directory the session's harness nominally ran in.
    #[arg(long, default_value = "/workspace")]
    workspace: String,
}

/// Why seeding failed.
#[derive(Debug, thiserror::Error)]
enum SeedError {
    /// The recording could not be read.
    #[error("failed to read recording")]
    Io(#[from] std::io::Error),
    /// A line was not a well-formed recorded frame.
    #[error("line {line} is not a recorded frame")]
    Frame {
        /// The offending line, 1-based.
        line: usize,
        /// What failed to parse.
        #[source]
        source: serde_json::Error,
    },
    /// The owner was not a valid Macro user id.
    #[error("invalid owner id")]
    Owner(#[source] anyhow::Error),
    /// Postgres could not be reached.
    #[error("failed to connect to {url}")]
    Connect {
        /// The database that could not be reached.
        url: String,
        /// What the driver reported.
        #[source]
        source: sqlx::Error,
    },
    /// The session row (and its channel) could not be written. Transparent
    /// because the repository's own context already names the failure.
    #[error(transparent)]
    CreateSession(#[from] agent_session::domain::error::AgentSessionError),
    /// A log entry could not be written.
    #[error("failed to write log entry {entry} of {total}")]
    WriteLog {
        /// The entry that failed, 1-based.
        entry: usize,
        /// How many entries the recording held.
        total: usize,
        /// What the repository reported.
        #[source]
        source: agent_session::domain::error::AgentSessionError,
    },
}

/// One line of a recording, as the recorder writes it.
///
/// [`Message`] is adjacently tagged on exactly these two fields, but the
/// recorder also flattens a `ts` in, so the line is taken apart here and the
/// frame rebuilt from the parts rather than deserialized straight into
/// [`Message`].
#[derive(Deserialize)]
struct RecordedLine {
    direction: Direction,
    content: serde_json::Value,
    /// Present when a user, rather than the runtime, originated the frame.
    #[serde(default)]
    user_id: Option<String>,
}

/// Which way the recorded frame was travelling.
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Direction {
    ToServer,
    ToRuntime,
}

/// Read a recording into log entries for `session`, in file order.
///
/// Blank lines are skipped; anything else must parse as a recorded frame.
fn read_recording(path: &Path, session: AgentSessionId) -> Result<Vec<AgentSessionLog>, SeedError> {
    let jsonl = std::fs::read_to_string(path)?;
    jsonl
        .lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .map(|(index, line)| parse_line(session, index + 1, line))
        .collect()
}

/// Parse one recorded line into a log entry for the given session.
fn parse_line(
    session: AgentSessionId,
    line_number: usize,
    line: &str,
) -> Result<AgentSessionLog, SeedError> {
    let frame = |source| SeedError::Frame {
        line: line_number,
        source,
    };
    let recorded: RecordedLine = serde_json::from_str(line).map_err(frame)?;
    let content = match recorded.direction {
        Direction::ToServer => {
            Message::ToServer(serde_json::from_value(recorded.content).map_err(frame)?)
        }
        Direction::ToRuntime => {
            Message::ToRuntime(serde_json::from_value(recorded.content).map_err(frame)?)
        }
    };
    let user_id = recorded
        .user_id
        .map(MacroUserIdStr::try_from)
        .transpose()
        .map_err(|_| SeedError::Frame {
            line: line_number,
            source: serde::de::Error::custom("user_id is not a Macro user id"),
        })?;
    Ok(AgentSessionLog {
        agent_session_id: session,
        user_id,
        content,
    })
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let args = Args::parse();
    match seed(&args).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => fail(&error),
    }
}

/// Persist the recording as a fresh agent session.
///
/// The session id is minted up front so the whole recording can be parsed -
/// and rejected on the first bad line - before anything is written.
async fn seed(args: &Args) -> Result<(), SeedError> {
    let session_id = AgentSessionId::new();
    let log = read_recording(&args.recording, session_id)?;
    let owner = MacroUserIdStr::try_from(args.owner.clone())
        .map_err(|error| SeedError::Owner(anyhow::anyhow!("{error}")))?;

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&args.database_url)
        .await
        .map_err(|source| SeedError::Connect {
            url: args.database_url.clone(),
            source,
        })?;
    // The same repo answers every port, exactly as the composition root in
    // `document_storage_service` wires them.
    let repo = PgAgentSessionRepo::new(pool);

    // Straight to the repo rather than `create_session`: that attaches a
    // transport, and a recording has no container to attach to. The row is
    // all a seeded session needs - its frames arrive from the file below.
    let session = AgentSessionRepo::create(
        &repo,
        CreateAgentSessionParams {
            id: session_id,
            owner_id: owner,
            bot_id: BotId::new_from_uuid(args.bot_id),
            thread_id: None,
            originating_message_id: None,
            model: args.model.clone(),
            harness: args.harness.clone(),
            repo_url: Some(args.repo_url.clone()),
            workspace: args.workspace.clone(),
            sandbox_size: agent_session::domain::model::SandboxSize::Default,
            // A recording is replayed, not run; nothing reads instructions.
            instructions: None,
            egress_token_hash: None,
        },
    )
    .await
    .map_err(SeedError::CreateSession)?;

    // Frames go in one at a time and in order: `agent_session_log` stamps
    // `created_at` itself and the log is read back `ORDER BY created_at, id`,
    // so append order is what makes the recording replay as recorded.
    //
    // One writer for the whole recording, so its fold is built once and
    // advanced a frame at a time. Rebuilding it per frame is what made long
    // recordings crawl.
    //
    // Nothing streams: a recording has no viewers to be live for, and pushing
    // its thousands of frames at a channel would only make the gateway replay
    // a session nobody is watching.
    let mut logs = LiveSessionLogWriter::new(repo.clone(), NoOpRealtime);

    let total = log.len();
    let started = Instant::now();
    for (index, entry) in log.into_iter().enumerate() {
        AgentSessionLogWriter::append(&mut logs, entry)
            .await
            .map_err(|source| SeedError::WriteLog {
                entry: index + 1,
                total,
                source,
            })?;
        if (index + 1) % 250 == 0 || index + 1 == total {
            eprintln!(
                "  {} / {total} frames ({:.1?})",
                index + 1,
                started.elapsed()
            );
        }
    }

    println!("session:  {}", session.id);
    println!("entries:  {total}");
    Ok(())
}

/// Print a failure and its cause chain.
fn fail(error: &dyn std::error::Error) -> ExitCode {
    eprint!("error: {error}");
    let mut cause = error.source();
    while let Some(source) = cause {
        eprint!(": {source}");
        cause = source.source();
    }
    eprintln!();
    ExitCode::FAILURE
}
