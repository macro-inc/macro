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
//! credential is embedded in the sensitive `macrod.toml`. Once paired, each
//! `agent_trigger.new` delivery opens a session over the harness service's
//! API, dials its runtime gateway, spawns the configured harness in ACP mode,
//! bridges its stdio to the websocket, and forwards the mention as the first
//! prompt; `agent_trigger.existing` deliveries forward follow-up messages,
//! redialing first when the bridge is gone.

mod config;
mod daemon;
mod dispatch;
mod harness;
mod outbound;
mod runtime;
mod trigger;
mod tui;

use clap::Parser;
use std::process::ExitCode;

use crate::daemon::absolute_config_path;

/// Serve a harness's agent sessions inside the control panel: registration,
/// bound agents, live sessions, config editing, pairing, removal, and logs -
/// one process.
#[derive(Parser)]
#[command(name = "macrod", version)]
struct Args {
    /// Internal browser helper, isolated so terminal browsers cannot claim the TUI's stdin.
    #[arg(long, hide = true)]
    open_url: Option<String>,
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
    // The daemon chdirs into the workspace, so the config path must stop
    // being relative before anything re-reads or rewrites it.
    let config_path = absolute_config_path(std::path::Path::new("macrod.toml"));

    // The TUI owns the terminal, so its logs go to a ring buffer it renders.
    let logs = tui::LogBuffer::install();
    match tui::run(&config_path, logs).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            // The ring buffer dies with the process and the terminal is
            // restored by now, so the exit error goes straight to stderr.
            eprintln!("macrod exited with an error: {error:?}");
            ExitCode::FAILURE
        }
    }
}
