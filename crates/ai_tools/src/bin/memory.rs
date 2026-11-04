#![recursion_limit = "256"]

use anyhow::Context;
use macro_user_id::user_id::MacroUserIdStr;
use memory::config::Config;
#[path = "memory/context.rs"]
mod context;
use context::build_tool_service_context;

use sqlx::postgres::PgConnectOptions;
use sqlx::postgres::PgPoolOptions;
use std::str::FromStr;
use std::time::Duration;
use tokio_util::task::TaskTracker;

const EVENT_BROKER_DRAIN_TIMEOUT: Duration = Duration::from_secs(10);

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    let config = Config::from_env().context("failed to load memory configuration")?;
    macro_entrypoint::MacroEntrypoint::new(config.environment).init();

    let user = MacroUserIdStr::try_from(config.user_id.clone())
        .context("USER_ID must be a valid Macro user id")?;

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect_with(PgConnectOptions::from_str(&config.database_url)?.application_name("memory"))
        .await?;

    let event_broker_tracker = TaskTracker::new();
    let import_jobs = ai_tools::ImportJobs::new();
    let tool_context = build_tool_service_context(
        pool.clone(),
        &config,
        event_broker_tracker.clone(),
        import_jobs.clone(),
    )
    .await?;
    let memory_service = ai_tools::memory::build_memory_service(pool, tool_context);

    tracing::info!("generating composed memory");
    let memory_result = memory_service
        .refresh_through(
            user,
            chrono::Utc::now().date_naive() - chrono::Duration::days(1),
        )
        .await;

    import_jobs.hand_over().await;

    tracing::info!("waiting for event broker publishes to drain");
    event_broker_tracker.close();
    match tokio::time::timeout(EVENT_BROKER_DRAIN_TIMEOUT, event_broker_tracker.wait()).await {
        Ok(()) => tracing::info!("event broker publishes drained"),
        Err(error) => tracing::warn!(
            error = ?error,
            timeout_seconds = EVENT_BROKER_DRAIN_TIMEOUT.as_secs(),
            "timed out waiting for event broker publishes to drain"
        ),
    }

    memory_result?;

    Ok(())
}
