//! The Outlook emulator as a standalone process, for pointing a locally
//! running `email_service` at.

use std::net::SocketAddr;
use std::path::PathBuf;

use clap::Parser;
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use outlook_emulator::{Options, OutlookEmulator, Seed, SeedError, StartError};

/// A stateful fake of the Microsoft Graph mail API and the Microsoft
/// identity platform Macro's email and sign-in code call.
#[derive(Parser)]
struct Args {
    /// The address to listen on.
    #[arg(long, default_value = "127.0.0.1:8481")]
    listen: SocketAddr,
    /// A YAML or JSON seed file: mailboxes and their mail.
    #[arg(long)]
    seed: Option<PathBuf>,
    /// The origin links in responses are built on, when clients reach the
    /// emulator through another address than the one it listens on.
    #[arg(long)]
    public_url: Option<String>,
    /// The origin a browser reaches the emulator at, when that is another
    /// address than services reach it at: the sign-in page is advertised
    /// there.
    #[arg(long)]
    browser_url: Option<String>,
    /// Accept `http://` notification URLs. Graph, and the emulator by
    /// default, accept only HTTPS.
    #[arg(long)]
    allow_http_notification_urls: bool,
    /// A PEM certificate to trust when calling an HTTPS notification URL,
    /// such as a local webhook's self-signed one. May be repeated.
    #[arg(long)]
    trust_certificate: Vec<PathBuf>,
}

#[derive(Debug, thiserror::Error)]
enum RunError {
    #[error(transparent)]
    Seed(#[from] SeedError),
    #[error(transparent)]
    Start(#[from] StartError),
    #[error("could not read a file or wait for ctrl-c: {0}")]
    Io(#[from] std::io::Error),
}

#[tokio::main]
async fn main() -> Result<(), RunError> {
    let _telemetry = MacroEntrypoint::new(Environment::Local).init();
    let args = Args::parse();

    let seed = match &args.seed {
        Some(path) => Seed::read(path)?,
        None => Seed::default(),
    };
    let mut options = Options {
        allow_http_notification_urls: args.allow_http_notification_urls,
        public_url: args.public_url,
        browser_url: args.browser_url,
        trusted_certificates: Vec::new(),
    };
    for path in &args.trust_certificate {
        options.trusted_certificates.push(std::fs::read(path)?);
    }

    let emulator = OutlookEmulator::start_on(args.listen, seed, options).await?;
    tracing::info!(
        graph_url = %emulator.graph_url(),
        login_url = %emulator.login_url(),
        login_page_url = %emulator.login_page_url(),
        authentication_service_url = %emulator.authentication_service_url(),
        control_url = %format!("{}/_emulator", emulator.base_url()),
        mailboxes = emulator.mailboxes().len(),
        "outlook emulator listening"
    );

    tokio::signal::ctrl_c().await?;
    emulator.shutdown().await;
    Ok(())
}
