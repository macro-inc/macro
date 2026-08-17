//! The runtime end of one agent session: dial the gateway, spawn the
//! configured harness in ACP mode, bridge its stdio to the websocket.

mod config;
mod harness;
mod link;

use clap::Parser;
use config::Config;
use std::path::PathBuf;
use std::process::ExitCode;

/// Serve one agent session: dial the gateway, run the harness, bridge them.
#[derive(Parser)]
struct Args {
    /// Path to the worker's TOML config.
    #[arg(long, default_value = "macro.toml")]
    config: PathBuf,
}

/// Anything that ends the worker.
#[derive(Debug, thiserror::Error)]
enum WorkerError {
    #[error(transparent)]
    Config(#[from] config::ConfigError),
    #[error("failed to dial the runtime gateway")]
    Dial(#[source] tokio_tungstenite::tungstenite::Error),
    #[error("failed to enter the harness working directory {path}")]
    Cwd {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error(transparent)]
    Harness(#[from] harness::BridgeError),
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let args = Args::parse();
    match run(&args.config).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(error = ?error, "worker exited with an error");
            ExitCode::FAILURE
        }
    }
}

async fn run(config_path: &std::path::Path) -> Result<(), WorkerError> {
    let config = Config::load(config_path)?;
    tracing::info!(session = %config.session.id, harness = %config.harness.command, "worker starting");

    std::env::set_current_dir(&config.harness.cwd).map_err(|source| WorkerError::Cwd {
        path: config.harness.cwd.clone(),
        source,
    })?;

    let channel = link::dial(&config.session)
        .await
        .map_err(WorkerError::Dial)?;
    harness::bridge(&config.harness, channel).await?;

    Ok(())
}
