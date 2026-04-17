#![recursion_limit = "256"]
//! CLI example for testing soup AI tools interactively.
//!
//! This example creates a CLI interface to test the soup toolset with real database connections.
//!
//! # Usage
//!
//! ```bash
//! DATABASE_URL=postgres://...
//! ANTHROPIC_API_KEY=sk_abcdefl...
//! LOCAL_USER_ID=macro|<email>
//! cargo run --example ai_tools_cli --features all
//! ```

use ai::tool::tool_loop::cli::Cli;
use ai::tool::types::RequestContext;
use ai::types::Model;
use comms::domain::service::ChannelServiceImpl;
use comms::outbound::postgres::comms_repo::PgCommsRepo;
use comms::outbound::postgres::user_repo::PgUserRepo;
use email::domain::ports::ReadonlyEmailPreviewAdapter;
use email::domain::service::EmailServiceImpl;
use email::outbound::EmailPgRepo;
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::outbound::postgres::FrecencyPgStorage;
use macro_user_id::user_id::MacroUserIdStr;
use soup::domain::service::SoupImpl;
use soup::inbound::toolset::{SoupToolContext, soup_toolset};
use soup::outbound::pg_soup_repo::PgSoupRepo;
use sqlx::PgPool;
#[tokio::main]
async fn main() {
    // Get database URL from environment
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let usr = std::env::var("LOCAL_USER_ID").expect("LOCAL_USER_ID must bes set");
    let user_id: MacroUserIdStr<'static> = usr.try_into().expect("valid user id macro|<email>");

    println!(
        "Running with\nuser [{}]\ndatabase [{}]",
        user_id, database_url
    );

    // Connect to the database
    let pool = PgPool::connect(&database_url)
        .await
        .expect("Failed to connect to database");

    // Create the frecency service (shared by multiple services)
    let frecency_storage = FrecencyPgStorage::new(pool.clone());
    let frecency_service = FrecencyQueryServiceImpl::new(frecency_storage.clone());

    // Create the email service with real database connections
    let email_repo = EmailPgRepo::new(pool.clone());
    let email_service = EmailServiceImpl::new(
        email_repo,
        frecency_service.clone(),
        email::domain::ports::NoOpEnqueuer,
        0,
    );

    // Create the channels service with real database connections
    let comms_repo = PgCommsRepo::new(readonly_pool::ReadOnlyPool(pool.clone()));
    let user_repo = PgUserRepo::new(pool.clone());
    let channels_service = ChannelServiceImpl::new(comms_repo, user_repo, frecency_storage);

    // Create the soup service with real database connections
    let soup_repo = PgSoupRepo::new(readonly_pool::ReadOnlyPool(pool));
    let soup_service = SoupImpl::new(
        soup_repo,
        frecency_service,
        ReadonlyEmailPreviewAdapter(email_service.clone()),
        channels_service,
        call::domain::ports::NoOpCallRecordQueryService,
    );

    // Create the soup tool context
    let soup_context = SoupToolContext::new(soup_service, email_service.clone());

    // Create the soup toolset
    let toolset = soup_toolset();

    let context = RequestContext { user_id };

    // Create the CLI
    let cli = Cli::new(
        toolset,
        soup_context,
        "You are an assistant that helps users explore and manage their documents, projects, and other entities. Use the available tools to list and find entities.",
        Model::Claude45Haiku,
        move || context.clone(),
    );

    // Run the CLI
    cli.run().await;
}
