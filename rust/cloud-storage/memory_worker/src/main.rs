mod handler;

use ai_tools::all_tools;
use anyhow::Context;
use aws_lambda_events::sqs::SqsEvent;
use handler::handler;
use lambda_runtime::{Error, LambdaEvent, run, service_fn, tracing};
use macro_entrypoint::MacroEntrypoint;
use memory::context::build_tool_service_context;
use memory::domain::service::MemoryServiceImpl;
use memory::outbound::pg_memory_repo::PgMemoryRepo;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();
    tracing::trace!("initiating memory_worker lambda");

    let database_url =
        std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;

    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(1)
        .connect(&database_url)
        .await
        .context("could not connect to db")?;

    let tool_context = build_tool_service_context(db.clone())
        .await
        .context("failed to build tool service context")?;

    let tools = all_tools();
    let repo = PgMemoryRepo::new(db);
    let service = Arc::new(MemoryServiceImpl::new(repo, tool_context, tools));

    let func = service_fn(move |event: LambdaEvent<SqsEvent>| {
        let service = service.clone();
        async move { handler(service, event).await }
    });

    run(func).await
}
