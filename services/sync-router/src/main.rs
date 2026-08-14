//! sync-router: forwards sync frames between the connection gateway's Redis
//! fanout and per-document downstreams (Durable Objects, chapter 1).

use anyhow::{Context, Result};
use macro_entrypoint::MacroEntrypoint;
use macro_env_var::env_vars;
use std::sync::Arc;
use sync_router::domain::router::Router;
use sync_router::inbound::redis_edge;
use sync_router::outbound::{do_downstream::DoDownstreamFactory, redis_sink::RedisSink};
use tokio::sync::mpsc;

env_vars! {
    pub struct RedisHost;
    pub struct SyncServiceUrl;
}

#[tokio::main]
async fn main() -> Result<()> {
    MacroEntrypoint::default().init();

    let redis_host = RedisHost::new().context("REDIS_HOST must be provided")?;
    let sync_service_url = SyncServiceUrl::new().context("SYNC_SERVICE_URL must be provided")?;

    let redis_client =
        redis::Client::open(redis_host.to_string()).context("failed to create redis client")?;
    let redis_connection = redis_client
        .get_multiplexed_async_connection()
        .await
        .context("failed to connect to redis")?;

    let (events_tx, events_rx) = mpsc::channel(4096);
    let sink = Arc::new(RedisSink::new(redis_connection));
    let downstreams = DoDownstreamFactory::new(
        sync_service_url.to_string(),
        Arc::clone(&sink),
        events_tx.clone(),
    );

    let router = Router::new(sink, downstreams);
    tokio::spawn(router.run(events_rx));

    tracing::info!("sync-router started");

    // The subscriber is the process's spine: resubscribe forever on Redis
    // failure. An Ok return means the router task itself is gone, which is
    // unrecoverable — exit non-zero and let the supervisor restart us.
    loop {
        match redis_edge::run(&redis_client, events_tx.clone()).await {
            Ok(()) => anyhow::bail!("router task shut down"),
            Err(error) => {
                tracing::error!(error = ?error, "fanout subscriber failed; reconnecting");
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
}
