//! The CapSolver emulator as a standalone process, for pointing a locally
//! running `agent_harness_service` at (`OVERRIDE_CAPSOLVER_API_URL`).

use std::net::SocketAddr;

use capsolver_emulator::{CapsolverEmulator, StartError};
use clap::Parser;
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;

/// A scripted stand-in for CapSolver's createTask/getTaskResult API. It
/// solves nothing.
#[derive(Parser)]
struct Args {
    /// The address to listen on.
    #[arg(long, default_value = "127.0.0.1:8483")]
    listen: SocketAddr,
}

#[derive(Debug, thiserror::Error)]
enum RunError {
    #[error(transparent)]
    Start(#[from] StartError),
    #[error("could not wait for ctrl-c: {0}")]
    Io(#[from] std::io::Error),
}

#[tokio::main]
async fn main() -> Result<(), RunError> {
    let _telemetry = MacroEntrypoint::new(Environment::Local).init();
    let args = Args::parse();

    let emulator = CapsolverEmulator::start_on(args.listen).await?;
    tracing::info!(
        base_url = %emulator.base_url(),
        control_url = %format!("{}/_emulator", emulator.base_url()),
        "CapSolver emulator listening"
    );

    tokio::signal::ctrl_c().await?;
    emulator.shutdown().await;
    Ok(())
}
