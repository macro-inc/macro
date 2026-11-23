use clap::{Parser, Subcommand};
use harnessd::auth::Agents;
use harnessd::claude::{ClaudeAuth, ClaudeConfig};
use harnessd::client::{self, ClientOutcome};
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use tokio::io::BufReader;

const DEFAULT_SOCKET: &str = "/run/harnessd/harnessd.sock";

/// Agent sign-ins on a Macro computer. Without a subcommand, forwards
/// request lines from stdin to the daemon and prints its answers.
#[derive(Parser)]
#[command(name = "harnessd")]
struct Arguments {
    /// The daemon's socket.
    #[arg(long, global = true, default_value = DEFAULT_SOCKET)]
    socket: PathBuf,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Run the daemon.
    Serve {
        /// Where credentials are stored.
        #[arg(long)]
        state_dir: PathBuf,
        /// The Claude Code executable.
        #[arg(long, default_value = "claude")]
        claude: PathBuf,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
    let arguments = Arguments::parse();

    match arguments.command {
        Some(Command::Serve { state_dir, claude }) => {
            serve(arguments.socket, state_dir, claude).await
        }
        None => forward(arguments.socket).await,
    }
}

async fn serve(socket: PathBuf, state_directory: PathBuf, claude: PathBuf) -> ExitCode {
    let listener = match harnessd::socket::listen(&socket) {
        Ok(listener) => listener,
        Err(error) => {
            tracing::error!(%error, socket = %socket.display(), "listening failed");
            return ExitCode::FAILURE;
        }
    };
    tracing::info!(socket = %socket.display(), "harnessd listening");

    let agents = Arc::new(Agents {
        claude: ClaudeAuth::new(ClaudeConfig::new(claude, state_directory)),
    });
    match harnessd::socket::serve(listener, agents).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(%error, "serving failed");
            ExitCode::FAILURE
        }
    }
}

async fn forward(socket: PathBuf) -> ExitCode {
    let input = BufReader::new(tokio::io::stdin());
    match client::run(&socket, input, tokio::io::stdout()).await {
        Ok(ClientOutcome::Answered) => ExitCode::SUCCESS,
        Ok(ClientOutcome::Unavailable) => ExitCode::FAILURE,
        Err(error) => {
            tracing::error!(%error, "forwarding to harnessd failed");
            ExitCode::FAILURE
        }
    }
}
