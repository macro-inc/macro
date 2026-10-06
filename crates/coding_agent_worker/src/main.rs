//! The agent harness daemon: serve a registered harness's agent sessions from
//! this machine.
//!
//! `macrod` is one process and one command: the serving core (SSE listener,
//! harness bridge) running inside a terminal control panel that shows what
//! it is serving - the registration, the agents bound to it, their sessions,
//! and the daemon's own logs - and manages its own pairing, config, and
//! retirement.
//!
//! A first run starts unpaired: the panel offers pairing (press `p`), the
//! user approves the printed code in the web app, and the minted harness
//! credential is embedded in the sensitive `macrod.toml`. Once paired, the
//! daemon connects to the runtime gateway and bridges the configured ACP
//! harness, making model discovery available before any agents exist. Each
//! `agent_trigger.new` delivery opens a session and forwards the first prompt;
//! `agent_trigger.existing` deliveries forward follow-up messages.

mod config;
mod daemon;
mod dispatch;
mod harness;
#[cfg(unix)]
mod herdr;
mod outbound;
mod repository;
mod runtime;
mod trigger;
mod tui;

use clap::Parser;
use std::process::ExitCode;

/// Serve a harness's agent sessions inside the control panel: registration,
/// bound agents, live sessions, config editing, pairing, removal, and logs -
/// one process.
#[derive(Parser)]
#[command(name = "macrod", version)]
struct Args {
    /// Internal browser helper, isolated so terminal browsers cannot claim the TUI's stdin.
    #[arg(long, hide = true)]
    open_url: Option<String>,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(clap::Subcommand)]
enum Command {
    /// Show one agent session live inside a herdr window. macrod opens these
    /// itself when it runs inside herdr.
    #[cfg(unix)]
    #[command(hide = true)]
    HerdrPane {
        /// The running macrod's window socket.
        #[arg(long)]
        socket: std::path::PathBuf,
        /// The ACP session to follow.
        #[arg(long)]
        session: String,
    },
    /// Serve ACP on stdio with each session as a live coding-agent TUI in
    /// its own herdr window. Set as the harness of a macrod run inside herdr.
    #[cfg(unix)]
    HerdrAcp {
        /// Private storage for this paired macrod instance.
        #[arg(long)]
        state_dir: Option<std::path::PathBuf>,
        /// Native model ID for new sessions.
        #[arg(long)]
        model: Option<String>,
        /// Open sessions in dispatcher-managed worktrees.
        #[arg(long, hide = true)]
        managed_worktrees: bool,
        /// Which agent TUI each session runs.
        #[arg(long, value_enum, default_value_t)]
        kind: herdr::acp_agent::TuiAgent,
        /// Claude Code's `--permission-mode` for every session, e.g.
        /// `acceptEdits` or `bypassPermissions`.
        #[arg(long)]
        permission_mode: Option<String>,
        /// Open each session's tab in the background rather than switching
        /// herdr to it.
        #[arg(long)]
        no_focus: bool,
        /// Extra arguments for every agent launch, e.g. `-- -s workspace-write`.
        #[arg(last = true)]
        agent_args: Vec<String>,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    // Dialing a `wss` gateway needs a process-wide provider, and rustls
    // installs none by itself. Before any dial, and idempotent: an error only
    // means somebody already did this.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    let args = Args::parse();
    if let Some(url) = args.open_url {
        return match webbrowser::open(&url) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("could not open browser: {error}");
                ExitCode::FAILURE
            }
        };
    }
    #[cfg(unix)]
    match args.command {
        Some(Command::HerdrPane { socket, session }) => {
            return match tui::run_herdr_pane(&socket, &session).await {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("macrod herdr-pane: {error:?}");
                    ExitCode::FAILURE
                }
            };
        }
        Some(Command::HerdrAcp {
            state_dir,
            model,
            managed_worktrees,
            kind,
            permission_mode,
            no_focus,
            agent_args,
        }) => {
            // stdout is the protocol: logs go to stderr, which macrod drains.
            tracing_subscriber::fmt()
                .with_writer(std::io::stderr)
                .init();
            return match herdr::acp_agent::run(herdr::acp_agent::AdapterOptions {
                state_dir,
                model,
                managed_worktrees,
                kind,
                permission_mode,
                no_focus,
                agent_args,
            })
            .await
            {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("macrod herdr-acp: {error:?}");
                    ExitCode::FAILURE
                }
            };
        }
        None => {}
    }
    let config_path = std::path::Path::new("macrod.toml");

    // The TUI owns the terminal, so its logs go to a ring buffer it renders.
    let logs = tui::LogBuffer::install();
    match tui::run(config_path, logs).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            // The ring buffer dies with the process and the terminal is
            // restored by now, so the exit error goes straight to stderr.
            eprintln!("macrod exited with an error: {error:?}");
            ExitCode::FAILURE
        }
    }
}
