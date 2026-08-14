//! sync-router: forwards sync frames between the connection gateway's Redis
//! fanout and per-document downstreams (Durable Objects, chapter 1; native
//! in-process sync machines, chapter 2, per `SYNC_NATIVE_MODE`).

use anyhow::{Context, Result};
use macro_entrypoint::MacroEntrypoint;
use macro_env_var::{env_vars, maybe_env_vars};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use sync_router::domain::router::Router;
use sync_router::inbound::redis_edge;
use sync_router::native::MachineHost;
use sync_router::native::downstream::NativeDownstreamFactory;
use sync_router::native::lifecycle::LifecycleReporter;
use sync_router::native::store::PgSyncStore;
use sync_router::outbound::split_downstream;
use sync_router::outbound::split_downstream::SplitDownstreamFactory;
use sync_router::outbound::{do_downstream::DoDownstreamFactory, redis_sink::RedisSink};
use tokio::sync::mpsc;

env_vars! {
    pub struct RedisHost;
    pub struct SyncServiceUrl;
}

maybe_env_vars! {
    /// `off` (default) | `all` | `prefix:<p>` — which documents bypass the
    /// Durable Object for the native in-process sync machines. (The macro
    /// derives the variable name from the struct name, so this struct shares
    /// its name with the mode enum, referenced by path below.)
    pub struct SyncNativeMode;
    /// Postgres for native sync persistence; required when the mode is not
    /// `off`.
    pub struct MacroDbUrl;
    /// HS256 secret for document-permission tokens; required when the mode is
    /// not `off` (on the DO path the DO itself validates).
    pub struct DocumentPermissionsSecret;
    /// DSS origin for lifecycle reporting (interactions, shallow snapshots);
    /// required when the mode is not `off`.
    pub struct DocumentStorageServiceUrl;
    /// Auth key for DSS internal endpoints; required when the mode is not
    /// `off`.
    pub struct DocumentStorageServiceAuthKey;
    /// Search-processing-service origin for reindex-on-edit; required when
    /// the mode is not `off`.
    pub struct SearchProcessingServiceUrl;
    /// Shared internal-service auth key (SPS `InternalOnly`); required when
    /// the mode is not `off`.
    pub struct InternalApiKey;
}

#[tokio::main]
async fn main() -> Result<()> {
    MacroEntrypoint::default().init();

    let redis_host = RedisHost::new().context("REDIS_HOST must be provided")?;
    let sync_service_url = SyncServiceUrl::new().context("SYNC_SERVICE_URL must be provided")?;
    let mode = match SyncNativeMode::new() {
        Some(raw) => split_downstream::SyncNativeMode::parse(&raw.to_string())?,
        None => split_downstream::SyncNativeMode::Off,
    };

    let redis_client =
        redis::Client::open(redis_host.to_string()).context("failed to create redis client")?;
    let redis_connection = redis_client
        .get_multiplexed_async_connection()
        .await
        .context("failed to connect to redis")?;

    let (events_tx, events_rx) = mpsc::channel(4096);
    let sink = Arc::new(RedisSink::new(redis_connection));
    let durable = DoDownstreamFactory::new(
        sync_service_url.to_string(),
        Arc::clone(&sink),
        events_tx.clone(),
    );

    if mode == split_downstream::SyncNativeMode::Off {
        let router = Router::new(Arc::clone(&sink), durable);
        tokio::spawn(router.run(events_rx));
    } else {
        let db_url = MacroDbUrl::new()
            .context("MACRO_DB_URL must be provided when SYNC_NATIVE_MODE is not off")?;
        let permissions_secret = DocumentPermissionsSecret::new().context(
            "DOCUMENT_PERMISSIONS_SECRET must be provided when SYNC_NATIVE_MODE is not off",
        )?;
        let document_storage_service_url = DocumentStorageServiceUrl::new().context(
            "DOCUMENT_STORAGE_SERVICE_URL must be provided when SYNC_NATIVE_MODE is not off",
        )?;
        let document_storage_service_auth_key = DocumentStorageServiceAuthKey::new().context(
            "DOCUMENT_STORAGE_SERVICE_AUTH_KEY must be provided when SYNC_NATIVE_MODE is not off",
        )?;
        let search_processing_service_url = SearchProcessingServiceUrl::new().context(
            "SEARCH_PROCESSING_SERVICE_URL must be provided when SYNC_NATIVE_MODE is not off",
        )?;
        let internal_api_key = InternalApiKey::new()
            .context("INTERNAL_API_KEY must be provided when SYNC_NATIVE_MODE is not off")?;
        let pool = PgPoolOptions::new()
            .max_connections(8)
            .connect(&db_url)
            .await
            .context("failed to connect to postgres")?;
        let store = PgSyncStore::new(pool);
        let reporter = LifecycleReporter::new(
            document_storage_service_url.to_string(),
            document_storage_service_auth_key.to_string(),
            search_processing_service_url.to_string(),
            internal_api_key.to_string(),
            store.clone(),
        );
        let host = MachineHost::spawn(store, reporter, Arc::clone(&sink), events_tx.clone());
        let native = NativeDownstreamFactory::new(
            host,
            permissions_secret.to_string(),
            Arc::clone(&sink),
            events_tx.clone(),
        );
        let router = Router::new(
            Arc::clone(&sink),
            SplitDownstreamFactory::new(mode.clone(), durable, native),
        );
        tokio::spawn(router.run(events_rx));
    }

    tracing::info!(mode = ?mode, "sync-router started");

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
