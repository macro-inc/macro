//! CLI example for testing email AI tools interactively.
//!
//! This example creates a CLI interface to test the email toolset with real
//! database connections and Gmail integration (for UpdateThreadLabels).
//!
//! # Usage
//!
//! ```bash
//! DATABASE_URL=postgres://...
//! ANTHROPIC_API_KEY=sk_abcdefl...
//! LOCAL_USER_ID=macro|<email>
//! REDIS_URL=redis://localhost:6379
//! AUTHENTICATION_SERVICE_URL=http://...
//! AUTHENTICATION_SERVICE_SECRET_KEY=...
//! cargo run -p email --example ai_tools_cli --features all
//! ```

use ai::tool::tool_loop::cli::Cli;
use ai::tool::types::RequestContext;
use ai::types::Model;
use email::domain::service::EmailServiceImpl;
use email::inbound::toolset::{EmailToolContext, email_toolset};
use email::outbound::{EmailPgRepo, GmailTokenProviderImpl};
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::outbound::postgres::FrecencyPgStorage;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("email=debug,ai=debug")),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let usr = std::env::var("LOCAL_USER_ID").expect("LOCAL_USER_ID must be set");
    let user_id: MacroUserIdStr<'static> = usr.try_into().expect("valid user id macro|<email>");
    let redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".to_string());
    let auth_service_url = std::env::var("AUTHENTICATION_SERVICE_URL")
        .expect("AUTHENTICATION_SERVICE_URL must be set");
    let auth_service_key = std::env::var("AUTHENTICATION_SERVICE_SECRET_KEY")
        .expect("AUTHENTICATION_SERVICE_SECRET_KEY must be set");

    println!(
        "Running with\nuser [{}]\ndatabase [{}]\nredis [{}]\nauth_service [{}]",
        user_id, database_url, redis_url, auth_service_url
    );

    let pool = PgPool::connect(&database_url)
        .await
        .expect("Failed to connect to database");

    let redis_client = redis::Client::open(redis_url).expect("Failed to create redis client");
    let redis_conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .expect("Failed to connect to redis");

    let auth_service_client = Arc::new(authentication_service_client::AuthServiceClient::new(
        auth_service_key,
        auth_service_url,
    ));

    let gmail_token_provider =
        Arc::new(GmailTokenProviderImpl::new(redis_conn, auth_service_client));
    let frecency_storage = FrecencyPgStorage::new(pool.clone());
    let frecency_service = FrecencyQueryServiceImpl::new(frecency_storage);

    let entity_access_service = Arc::new(
        entity_access::domain::service::EntityAccessServiceImpl::new(
            entity_access::outbound::PgAccessRepository::new(pool.clone()),
        ),
    );

    let email_repo = EmailPgRepo::new(pool);
    let email_service = EmailServiceImpl::new(
        email_repo,
        frecency_service,
        email::domain::ports::NoOpEnqueuer,
        0,
    );

    let email_context = EmailToolContext::new(
        Arc::new(email_service),
        gmail_token_provider,
        entity_access_service,
    );
    let toolset = email_toolset();

    #[expect(deprecated)]
    let context = RequestContext { user_id };

    let cli = Cli::new(
        toolset,
        email_context,
        "You are an assistant that helps users manage their email. Use the available tools to list labels, add/remove labels from threads, create drafts, and read email threads.",
        Model::Claude45Haiku,
        move || context.clone(),
    );

    cli.run().await;
}
