//! CLI example for testing documents AI tools interactively.
//!
//! This example creates a CLI interface to test the documents toolset with real database connections.
//!
//! # Usage
//!
//! ```bash
//! DATABASE_URL=postgres://...
//! ANTHROPIC_API_KEY=sk_abcdefl...
//! LOCAL_USER_ID=macro|<email>
//! SYNC_SERVICE_URL=...
//! SYNC_SERVICE_AUTH_KEY=...
//! DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL=...
//! DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME=THE PRIVATE KEY
//! DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID=...
//! cargo run --example documents_toolset
//! ```

use ai::tool::tool_loop::cli::Cli;
use ai::tool::types::RequestContext;
use ai::types::Model;
use documents::domain::models::CloudFrontConfig;
use documents::domain::service::DocumentServiceImpl;
use documents::inbound::toolset::{DocumentToolContext, document_toolset};
use documents::outbound::pg_document_repo::PgDocumentRepo;
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use lexical_client::LexicalClient;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use std::sync::Arc;
use sync_service_client::SyncServiceClient;

/// The prompt to use in the example.
const PROMPT: &str = "You are an assistant that helps users explore and manage their documents. Use the available tools to read document metadata.";

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    // Get database URL from environment
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let usr = std::env::var("LOCAL_USER_ID").expect("LOCAL_USER_ID must bes set");
    let user_id: MacroUserIdStr<'static> = usr.try_into().expect("valid user id macro|<email>");

    let sync_service_url = std::env::var("SYNC_SERVICE_URL").expect("SYNC_SERVICE_URL must be set");
    let lexical_service_url =
        std::env::var("LEXICAL_SERVICE_URL").expect("LEXICAL_SERVICE_URL must be set");
    let sync_service_auth_key =
        std::env::var("SYNC_SERVICE_AUTH_KEY").expect("SYNC_SERVICE_AUTH_KEY must be set");

    println!(
        "Running with\nuser [{}]\ndatabase [{}]",
        user_id, database_url
    );

    // Connect to the database
    let pool = PgPool::connect(&database_url)
        .await
        .expect("Failed to connect to database");

    let entity_access_repo = PgAccessRepository::new(pool.clone());
    let entity_access_service = EntityAccessServiceImpl::new(entity_access_repo);

    let documents_repo = PgDocumentRepo::new(pool.clone());
    let documents_service = DocumentServiceImpl::new(
        documents_repo,
        CloudFrontConfig {
            distribution_url: std::env::var("DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL")
                .expect("DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL must be set"),
            signer_public_key_id: std::env::var(
                "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID",
            )
            .expect("DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID must be set"),
            signer_private_key: std::env::var(
                "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME",
            )
            .expect(
                "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME must be set",
            ),
            presigned_url_expiry_seconds: 840,
            browser_cache_expiry_seconds: 900,
        },
        SyncServiceClient::new(sync_service_auth_key.clone(), sync_service_url),
        pool,
    );

    let lexical_client = LexicalClient::new(sync_service_auth_key, lexical_service_url);

    let document_tool_context =
        DocumentToolContext::new(documents_service, entity_access_service, lexical_client);

    let toolset = document_toolset();

    let context = RequestContext {
        user_id: Arc::new(user_id),
        // Remove this later
        #[allow(deprecated)]
        jwt: Arc::new(String::new()),
    };

    // Create the CLI
    let cli = Cli::new(
        toolset,
        document_tool_context,
        PROMPT,
        Model::Claude45Haiku,
        move || context.clone(),
    );

    // Run the CLI
    cli.run().await;
}
