//! ACP sidecar
//!
//! A dumb byte pipe between one websocket connection and one `<harness> acp`
//! process's stdio. The harness speaks ndjson on stdio; we forward raw bytes
//! both ways and let the client's ACP SDK do all framing.
//!
//! Process-per-connection: connect spawns the harness, disconnect kills it.
//! GET /ping is a readiness probe callers poll before connecting.

use clap::Parser;

use crate::server::{Config, app};

mod server;

/// Bridge one websocket connection to one ACP harness process's stdio.
#[derive(Parser)]
struct Args {
    /// ACP harness binary (name or absolute path).
    #[arg(long, env = "ACP_HARNESS", default_value = "opencode")]
    harness: String,
    /// Directory the harness runs the agent in.
    #[arg(long, env = "ACP_WORKSPACE", default_value = "/workspace")]
    workspace: String,
    /// Port to listen on.
    #[arg(long, env = "ACP_PORT", default_value_t = 8700)]
    port: u16,
    /// Shared secret bridge connections must present (query `?token=` or
    /// bearer header). Unset = no auth; only safe behind a trusted proxy.
    #[arg(long, env = "ACP_TOKEN")]
    token: Option<String>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().init();

    let args = Args::parse();
    tracing::info!(
        port = args.port,
        harness = %args.harness,
        workspace = %args.workspace,
        auth = args.token.is_some(),
        "acp-sidecar listening"
    );
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", args.port))
        .await
        .expect("bind sidecar port");
    let config = Config::new(args.harness, args.workspace, args.token);
    axum::serve(listener, app(config)).await.expect("serve");
}
