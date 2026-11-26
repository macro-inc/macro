//! The model emulator as a standalone process, for pointing a locally
//! running `agent_harness_service` at.

use std::net::SocketAddr;

use clap::Parser;
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use model_emulator::{ModelEmulator, StartError};

/// A scripted stand-in for the Gemini GenerateContent API the assistant's
/// model router calls. It runs no model.
#[derive(Parser)]
struct Args {
    /// The address to listen on.
    #[arg(long, default_value = "127.0.0.1:8482")]
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

    let emulator = ModelEmulator::start_on(args.listen).await?;
    tracing::info!(
        base_url = %emulator.base_url(),
        control_url = %format!("{}/_emulator", emulator.base_url()),
        "model emulator listening"
    );

    tokio::signal::ctrl_c().await?;
    emulator.shutdown().await;
    Ok(())
}
