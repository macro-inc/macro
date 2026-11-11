//! The Gmail emulator as a standalone process, for pointing a locally
//! running `email_service` at.

use std::net::SocketAddr;
use std::path::PathBuf;

use clap::Parser;
use gmail_emulator::{
    DEFAULT_PUSH_AUDIENCE, GmailEmulator, PushConfig, Seed, SeedError, StartError,
};

/// A stateful fake of the Google APIs Macro's email code calls.
#[derive(Parser)]
struct Args {
    /// The address to listen on.
    #[arg(long, default_value = "127.0.0.1:8480")]
    listen: SocketAddr,
    /// A YAML or JSON seed file: mailboxes and their mail.
    #[arg(long)]
    seed: Option<PathBuf>,
    /// The webhook Gmail watch notifications are posted to, such as
    /// `http://127.0.0.1:8080/gmail/webhook`. Overrides the seed's.
    #[arg(long)]
    push_endpoint: Option<String>,
    /// The audience of the token signed for the webhook.
    #[arg(long, default_value = DEFAULT_PUSH_AUDIENCE)]
    push_audience: String,
}

#[derive(Debug, thiserror::Error)]
enum RunError {
    #[error(transparent)]
    Seed(#[from] SeedError),
    #[error(transparent)]
    Start(#[from] StartError),
    #[error("could not wait for ctrl-c: {0}")]
    Signal(#[from] std::io::Error),
}

#[tokio::main]
async fn main() -> Result<(), RunError> {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    let mut seed = match &args.seed {
        Some(path) => Seed::read(path)?,
        None => Seed::default(),
    };
    if let Some(endpoint) = args.push_endpoint {
        seed.push = Some(PushConfig {
            endpoint,
            audience: args.push_audience,
        });
    }

    let emulator = GmailEmulator::start_on(args.listen, seed).await?;
    tracing::info!(
        gmail_url = %emulator.gmail_url(),
        people_url = %emulator.people_url(),
        certs_url = %emulator.certs_url(),
        token_url = %emulator.token_url(),
        control_url = %format!("{}/_emulator", emulator.base_url()),
        mailboxes = emulator.mailboxes().len(),
        "gmail emulator listening"
    );

    tokio::signal::ctrl_c().await?;
    emulator.shutdown().await;
    Ok(())
}
