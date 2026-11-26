//! Serves the **Attio MCP stand-in (synthetic records, ASSUMED output
//! shape) — not Attio** over streamable HTTP at
//! `http://127.0.0.1:<port>/mcp`, for a local end-to-end import run.

use std::net::Ipv4Addr;
use std::sync::Arc;

use clap::Parser;
use import_attio::standin::{AttioStandin, LABEL};
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};

/// Serve the Attio MCP stand-in on loopback.
#[derive(Parser)]
struct Args {
    /// Port on 127.0.0.1.
    #[arg(long, default_value_t = 8931)]
    port: u16,
    /// Serve a workspace that has not turned deals on.
    #[arg(long)]
    without_deals: bool,
    /// Serve at most this many records a page.
    #[arg(long)]
    page_cap: Option<u32>,
}

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let args = Args::parse();
    let mut standin = AttioStandin::new();
    if args.without_deals {
        standin = standin.without_deals();
    }
    if let Some(cap) = args.page_cap {
        standin = standin.with_page_cap(cap);
    }

    let service = StreamableHttpService::new(
        move || Ok(standin.clone()),
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default(),
    );
    let router = axum::Router::new().nest_service("/mcp", service);
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, args.port)).await?;

    eprintln!("{LABEL}: http://127.0.0.1:{}/mcp", args.port);
    axum::serve(listener, router).await?;
    Ok(())
}
