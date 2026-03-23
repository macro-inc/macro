use ai_tools::all_tools;
use macro_user_id::user_id::MacroUserIdStr;
use memory::context::build_tool_service_context;
use memory::domain::{MemoryService, service::MemoryServiceImpl};
use memory::outbound::pg_memory_repo::PgMemoryRepo;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    macro_entrypoint::MacroEntrypoint::default().init();

    let database_url = std::env::var("DATABASE_URL")?;

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    let tool_context = build_tool_service_context(pool.clone()).await?;
    let tools = all_tools();
    let memory_repo = PgMemoryRepo::new(pool);
    let memory_service = MemoryServiceImpl::new(memory_repo, tool_context, tools);

    let user: MacroUserIdStr<'static> = "macro|eric.hayes@macro.com"
        .to_string()
        .try_into()
        .expect("valid user id");

    tracing::info!("Generating memory for {user}...");
    let memory = memory_service.generate_memory(user).await?;
    println!("{memory}");

    Ok(())
}
