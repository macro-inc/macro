//! One shared container supervising isolated, short-lived Deno processes.

mod config;

use code_execution::{
    domain::{ExecutionService, Limits},
    inbound,
    outbound::deno::DenoRunner,
    protocol::ServiceToken,
};
use std::{sync::Arc, time::Duration};

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let entrypoint = macro_entrypoint::MacroEntrypoint::default().init();
    let result = run().await;
    entrypoint.shutdown();
    result
}

#[tracing::instrument(err)]
async fn run() -> Result<(), rootcause::Report> {
    let config = macro_config::ConfigLoader::load::<config::Config>()?;
    let token = ServiceToken::new(config.code_execution_token)?;
    let limits = Limits {
        max_running: config.max_running,
        max_queued: config.max_queued,
        max_duration: Duration::from_millis(config.max_duration_ms),
        ..Limits::default()
    };
    limits.validate()?;
    let max_connections = limits.max_running + limits.max_queued + 16;
    let runner = DenoRunner::new(
        config.deno_binary.into(),
        config.deno_scratch_directory.into(),
        config.deno_heap_mb,
    )
    .await?;
    let service = ExecutionService::new(Arc::new(runner), limits)?;
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", config.port)).await?;
    tracing::info!(port = config.port, "code execution listener ready");
    let shutdown = service.clone();
    let result = axum::serve(
        listener,
        inbound::router(service.clone(), token, max_connections),
    )
    .with_graceful_shutdown(async move {
        macro_entrypoint::shutdown_signal().await;
        shutdown.shutdown().await;
    })
    .await;
    service.shutdown().await;
    result?;
    Ok(())
}
