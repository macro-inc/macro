#![recursion_limit = "256"]

use ai_tools::{all_tools, build_tool_service_context_from_env};
use anyhow::Context;
use macro_user_id::user_id::MacroUserIdStr;
use memory::config::Config;
use memory::domain::{MemoryService, service::MemoryServiceImpl};
use memory::outbound::pg_memory_repo::PgMemoryRepo;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    let config = Config::from_env().context("failed to load memory configuration")?;
    macro_entrypoint::MacroEntrypoint::new(config.environment).init();

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await?;

    let tool_context = build_tool_service_context_from_env(pool.clone()).await?;
    let tools = all_tools();
    let memory_repo = PgMemoryRepo::new(pool.clone());
    let memory_service = MemoryServiceImpl::new(pool, memory_repo, tool_context, tools);

    let user = MacroUserIdStr::try_from(config.user_id.clone())
        .context("USER_ID must be a valid Macro user id")?;

    tracing::info!("Generating memory for {user}...");
    match memory_service.get_or_generate_memory(user).await? {
        Some(memory) => println!("{memory}"),
        None => println!("No memory yet, generation triggered in background"),
    }

    Ok(())
}
