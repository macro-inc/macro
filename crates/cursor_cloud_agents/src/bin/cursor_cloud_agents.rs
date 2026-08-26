//! The `cursor_cloud_agents` binary: an ACP agent backed by Cursor cloud agents.
//!
//! Point any ACP client (Zed's `agent_servers`, an editor extension, a test
//! driver) at this executable. ACP in on stdin, ACP out on stdout, logs on
//! stderr and — unless disabled — a JSONL-ish trace file under
//! `~/.cursor-debug/`, which is the thing to read when a client reports the
//! agent misbehaved.
//!
//! # This agent never asks permission
//!
//! A local ACP agent asks before it edits or runs anything, via
//! `session/request_permission`. This one cannot: the work happens in
//! Cursor's cloud sandbox, which approves tool use server-side and gives the
//! bridge no hook to intercept. Whatever gate the client offers does not
//! apply here, so the agent says so on stderr at startup rather than letting
//! the absence pass for consent.
//!
//! For the same reason the agent works on a *clone* of the repository at
//! `CURSOR_REF`, not the checkout the client is sitting in: uncommitted local
//! work is invisible to it, and its edits land on a Cursor-side branch.
//!
//! Environment:
//! - `CURSOR_API_KEY` (required): a `crsr_…` user or service-account key.
//! - `CURSOR_REPO`: repository override; otherwise resolved from the
//!   session's `cwd` origin remote.
//! - `CURSOR_REF`: starting ref for new agents (default `main`).
//! - `CURSOR_MODEL`: model id (default: server default).
//! - `CURSOR_API_BASE`: API base url (default `https://api.cursor.com`).
//! - `CURSOR_ACP_LOG_DIR`: log directory (default `~/.cursor-debug`; `off`
//!   disables the file log).
//! - `CURSOR_ACP_RECORD_DIR`: record each run's raw SSE bytes here, one
//!   `<agent>-<run>.sse` per run, for turning a real session into a test
//!   fixture. Unset records nothing. Recordings carry whatever the run
//!   saw — prompts, file contents, terminal output — so sanitize before
//!   committing one (`crates/cursor_cloud_agents/fixtures/real/README.md`).
//! - `RUST_LOG`: tracing filter (default `info`; `debug` logs every frame
//!   and SSE event).

use cursor_cloud_agents::api::{ApiKey, CursorClient, CursorConfig};
use cursor_cloud_agents::domain::model::RepoUrl;
use cursor_cloud_agents::domain::service::CursorSessionService;
use cursor_cloud_agents::inbound::acp::{AcpNotifier, serve};
use cursor_cloud_agents::outbound::git::GitRepoResolver;
use macro_env_var::{env_var, maybe_env_var};
use std::process::ExitCode;
use std::sync::Arc;
use tracing_subscriber::layer::SubscriberExt as _;
use tracing_subscriber::util::SubscriberInitExt as _;

env_var! {
    /// The Cursor API key.
    struct CursorApiKey;
}

maybe_env_var! {
    /// Repository override for every session.
    struct CursorRepo;
}

maybe_env_var! {
    /// Starting ref for new agents' repositories.
    struct CursorRef;
}

maybe_env_var! {
    /// Model id override.
    struct CursorModel;
}

maybe_env_var! {
    /// API base url override, for tests and proxies.
    struct CursorApiBase;
}

maybe_env_var! {
    /// Debug log directory; `off` disables the file log.
    struct CursorAcpLogDir;
}

maybe_env_var! {
    /// Directory to record each run's raw SSE into; unset records nothing.
    struct CursorAcpRecordDir;
}

#[tokio::main]
async fn main() -> ExitCode {
    let log_dir = CursorAcpLogDir::new();
    let file_layer = debug_log_layer(log_dir.as_ref().and_then(|dir| dir.value()));
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        // Stderr, never stdout: stdout is the ACP stream.
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(std::io::stderr)
                .with_ansi(false),
        )
        .with(file_layer)
        .init();

    let Ok(api_key) = CursorApiKey::new() else {
        eprintln!("cursor_cloud_agents: CURSOR_API_KEY is not set");
        return ExitCode::from(78);
    };

    let configured_model = CursorModel::new().and_then(|model| model.value().map(str::to_owned));
    let config = CursorConfig {
        api_key: ApiKey::new(api_key.as_ref()),
        base_url: CursorApiBase::new()
            .and_then(|base| base.value().map(str::to_owned))
            .unwrap_or_else(|| cursor_cloud_agents::api::CURSOR_API_BASE_URL.to_owned()),
        model: configured_model.clone(),
        starting_ref: CursorRef::new()
            .and_then(|reference| reference.value().map(str::to_owned))
            .unwrap_or_else(|| "main".to_owned()),
        record_dir: CursorAcpRecordDir::new()
            .and_then(|dir| dir.value().map(std::path::PathBuf::from)),
    };
    let client = match CursorClient::new(config) {
        Ok(client) => client,
        Err(error) => {
            eprintln!("cursor_cloud_agents: {error}");
            return ExitCode::from(78);
        }
    };

    let override_repo = CursorRepo::new().and_then(|repo| repo.value().and_then(RepoUrl::parse));
    let repos = GitRepoResolver { override_repo };

    // ACP has no capability field for "I will never ask permission", and a
    // client's gate silently not applying is the kind of thing a user only
    // discovers afterwards. Said once, on stderr, where the client shows it.
    tracing::warn!(
        "cursor cloud agents approve their own tool use: this agent never sends \
         session/request_permission, so the client's permission prompts do not \
         apply to anything it does"
    );

    // Stdio is just one instantiation of the adapter; the connection drains
    // its outgoing queue on EOF, so a client that batches requests and closes
    // stdin still gets every answer.
    let notifier = AcpNotifier::new();
    // `CURSOR_MODEL` names an id; its params come from Cursor's default
    // variant for that model, since Cursor rejects an id whose params are not a
    // variant it knows. A client may change it per session from here.
    let service = Arc::new(
        CursorSessionService::new(client, notifier.clone(), repos)
            .with_default_model(configured_model),
    );
    match serve(service, notifier, tokio::io::stdin(), tokio::io::stdout()).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("cursor_cloud_agents: acp connection failed: {error}");
            ExitCode::FAILURE
        }
    }
}

/// A file layer writing to `<dir>/acp-<pid>.log`, or `None` when disabled or
/// unopenable. Per-process file: an editor can run several agents at once,
/// and interleaved frames from two sessions are what makes a log useless.
fn debug_log_layer<S>(dir: Option<&str>) -> Option<impl tracing_subscriber::Layer<S>>
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
{
    let dir = match dir {
        Some("off" | "none") => return None,
        Some(dir) => std::path::PathBuf::from(dir),
        None => std::env::home_dir()?.join(".cursor-debug"),
    };
    if let Err(error) = std::fs::create_dir_all(&dir) {
        eprintln!(
            "cursor_cloud_agents: cannot create log dir {}: {error}",
            dir.display()
        );
        return None;
    }
    let path = dir.join(format!("acp-{}.log", std::process::id()));
    match std::fs::File::create(&path) {
        Ok(file) => {
            // Findable from whatever the client shows of the agent's stderr.
            eprintln!("cursor_cloud_agents: logging to {}", path.display());
            Some(
                tracing_subscriber::fmt::layer()
                    .with_writer(std::sync::Arc::new(file))
                    .with_ansi(false),
            )
        }
        Err(error) => {
            eprintln!(
                "cursor_cloud_agents: cannot open {}: {error}",
                path.display()
            );
            None
        }
    }
}
