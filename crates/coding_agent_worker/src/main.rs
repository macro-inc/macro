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
//! credential is embedded in the sensitive `~/.macrod/macrod.toml`. Once paired, the
//! daemon connects to the runtime gateway and bridges the configured ACP
//! harness, making model discovery available before any agents exist. Each
//! `agent_trigger.new` delivery opens a session and forwards the first prompt;
//! `agent_trigger.existing` deliveries forward follow-up messages.

mod config;
mod daemon;
mod dispatch;
mod executable;
#[cfg(unix)]
mod handoff;
mod harness;
#[cfg(unix)]
mod herdr;
mod outbound;
mod repository;
mod runtime;
mod self_knowledge;
mod service;
mod trigger;
mod tui;
mod turns;
mod update;

use clap::Parser;
use std::process::ExitCode;

/// Serve a harness's agent sessions inside the control panel: registration,
/// bound agents, live sessions, config editing, pairing, removal, and logs -
/// one process.
#[derive(Parser)]
#[command(name = "macrod", version = update::VERSION)]
struct Args {
    /// Internal browser helper, isolated so terminal browsers cannot claim the TUI's stdin.
    #[arg(long, hide = true)]
    open_url: Option<String>,
    /// Config file for the control panel; defaults to `~/.macrod/macrod.toml`,
    /// the one `macrod service` also uses.
    #[arg(long)]
    config: Option<std::path::PathBuf>,
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
    /// Run headless, managed by an embedding app such as the Macro desktop
    /// app: no terminal panel, state changes as JSON lines on stdout, and
    /// shutdown on SIGTERM, Ctrl-C, or stdin closing.
    Service {
        /// Config file; defaults to `~/.macrod/macrod.toml`, created when the
        /// setup flags are given.
        #[arg(long)]
        config: Option<std::path::PathBuf>,
        /// Agent preset id from `detect-agents`, e.g. `claude-code`.
        #[arg(long)]
        agent: Option<String>,
        /// Absolute directory sessions run in; created when missing.
        #[arg(long)]
        workspace: Option<std::path::PathBuf>,
    },
    /// List the ACP agents installed on this machine as JSON.
    DetectAgents,
    /// Report the service config's state as JSON without running anything.
    Inspect {
        /// Config file; defaults to `~/.macrod/macrod.toml`.
        #[arg(long)]
        config: Option<std::path::PathBuf>,
    },
}

/// The default config, after moving one an older release left in the working
/// directory to it.
fn default_tui_config() -> rootcause::Result<std::path::PathBuf> {
    let path = config::default_config_path().ok_or_else(|| {
        rootcause::report!("no config path: pass --config or set HOME (USERPROFILE on Windows)")
    })?;
    let legacy = std::path::Path::new("macrod.toml");
    config::adopt_working_directory_config(&path, legacy).map_err(|error| {
        rootcause::report!(
            "could not move ./macrod.toml to {}: {error}",
            path.display()
        )
    })?;
    Ok(path)
}

#[tokio::main]
async fn main() -> ExitCode {
    // Dialing a `wss` gateway needs a process-wide provider, and rustls
    // installs none by itself. Before any dial, and idempotent: an error only
    // means somebody already did this.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    // The installed `macrod.exe` on Windows only starts the newest version.
    #[cfg(windows)]
    if let Some(code) = update::versions::run_as_launcher() {
        std::process::exit(code);
    }

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
    match args.command {
        Some(Command::Service {
            config,
            agent,
            workspace,
        }) => {
            // stdout is the event protocol: logs go to stderr, like herdr-acp.
            tracing_subscriber::fmt()
                .with_writer(std::io::stderr)
                .init();
            return match service::run(service::ServiceOptions {
                config,
                agent,
                workspace,
            })
            .await
            {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    service::emit_fatal(&format!("{error}"));
                    eprintln!("macrod service: {error:?}");
                    ExitCode::FAILURE
                }
            };
        }
        Some(Command::DetectAgents) => {
            println!("{}", service::detect_agents_json());
            return ExitCode::SUCCESS;
        }
        Some(Command::Inspect { config }) => {
            return match service::inspect_json(config) {
                Ok(inspection) => {
                    println!("{inspection}");
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("macrod inspect: {error:?}");
                    ExitCode::FAILURE
                }
            };
        }
        #[cfg(unix)]
        Some(Command::HerdrPane { socket, session }) => {
            return match tui::run_herdr_pane(&socket, &session).await {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("macrod herdr-pane: {error:?}");
                    ExitCode::FAILURE
                }
            };
        }
        #[cfg(unix)]
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
    // The TUI owns the terminal, so its logs go to a ring buffer it renders.
    // Installed first so the config move and load below log into it.
    let logs = tui::LogBuffer::install();
    let config_path = match args.config {
        Some(path) => path,
        None => match default_tui_config() {
            Ok(path) => path,
            Err(error) => {
                eprintln!("macrod: {error:?}");
                return ExitCode::FAILURE;
            }
        },
    };
    // Released by the exec of an update handoff (the descriptor is
    // close-on-exec); the replacement process takes it again right here.
    let _lock = match config::lock(&config_path) {
        Ok(lock) => lock,
        Err(error) => {
            eprintln!("macrod: {error}");
            return ExitCode::FAILURE;
        }
    };
    // The agent the macrod this process replaced was relaying, if any.
    #[cfg(unix)]
    let mut inherited = handoff::take_inherited();
    #[cfg(not(unix))]
    let mut inherited = None;
    update::log::record(update::log::UpdateEvent::Startup {
        version: update::VERSION.to_owned(),
        from_handoff: inherited.is_some(),
    });
    loop {
        match tui::run(&config_path, logs.clone(), inherited.take()).await {
            Ok(None) => return ExitCode::SUCCESS,
            #[cfg(unix)]
            Ok(Some(restart)) => {
                // Only returns when the new binary could not be started; the
                // panel comes back up and keeps serving, with a fresh agent.
                let error = restart.installed.relaunch(restart.agent);
                tracing::error!(error = ?error, "could not restart into the updated macrod");
            }
            #[cfg(not(unix))]
            Ok(Some(never)) => match never {},
            Err(error) => {
                // The ring buffer dies with the process and the terminal is
                // restored by now, so the exit error goes straight to stderr.
                eprintln!("macrod exited with an error: {error:?}");
                return ExitCode::FAILURE;
            }
        }
    }
}
