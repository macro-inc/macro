#![recursion_limit = "256"]

use ai_tools::{AiHost, build_tool_service_context_from_env, tools_for};
use anyhow::Context;
use macro_user_id::user_id::MacroUserIdStr;
use memory::config::Config;
use memory::domain::{MemoryService, service::MemoryServiceImpl};
use memory::outbound::pg_memory_repo::PgMemoryRepo;
use sqlx::postgres::PgPoolOptions;
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
        .connect(&config.database_url)
        .await?;

    let event_broker_tracker = TaskTracker::new();
    let tool_context =
        build_tool_service_context_from_env(pool.clone(), event_broker_tracker.clone()).await?;
    let tools = tools_for(AiHost::Chat);
    let memory_repo = PgMemoryRepo::new(pool);
    let memory_service = MemoryServiceImpl::new(memory_repo, tool_context, tools);

    tracing::info!("Generating memory for {user}...");
    let memory_result = memory_service.get_or_generate_memory(user).await;

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

    match memory_result? {
        Some(memory) => println!("{memory}"),
        None => println!("No memory yet, generation triggered in background"),
    }

    Ok(())
}
