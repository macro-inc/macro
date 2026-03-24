#![recursion_limit = "256"]
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
//! DOCUMENT_STORAGE_BUCKET=...
//! DOCX_DOCUMENT_UPLOAD_BUCKET=...
//! cargo run --example documents_toolset
//! ```

use ai::tool::tool_loop::cli::Cli;
use ai::tool::types::RequestContext;
use ai::types::Model;
use connection::domain::ports::ConnectionService;
use documents::domain::models::CloudFrontConfig;
use documents::domain::ports::TaskPropertiesPort;
use documents::domain::service::DocumentServiceImpl;
use documents::inbound::toolset::{DocumentToolContext, document_toolset};
use documents::outbound::pg_document_repo::PgDocumentRepo;
use documents::outbound::s3_upload_url::S3UploadUrlAdapter;
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use lexical_client::LexicalClient;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use std::sync::Arc;
use sync_service_client::SyncServiceClient;

/// No-op connection service
#[derive(Clone)]
struct NoOpConnectionService;

impl ConnectionService for NoOpConnectionService {
    async fn send_invalidation_event<'a, T: std::fmt::Debug + serde::Serialize + Send>(
        &self,
        _invalidation_event: connection::domain::models::InvalidationEvent<'a, T>,
    ) -> Result<(), connection::domain::models::ConnectionError> {
        Ok(())
    }
}

/// No-op task properties service (not needed for toolset example).
#[derive(Clone)]
struct NoOpTaskProperties;

impl TaskPropertiesPort for NoOpTaskProperties {
    async fn attach_task_properties(&self, _entity_ids: Vec<String>) -> anyhow::Result<()> {
        Ok(())
    }

    async fn update_task_status(&self, _task_id: &str, _status: &str) -> anyhow::Result<()> {
        Ok(())
    }

    async fn set_entity_property(
        &self,
        _user_id: &str,
        _entity_id: &str,
        _property_definition_id: uuid::Uuid,
        _value: Option<models_properties::api::requests::SetPropertyValue>,
    ) -> anyhow::Result<()> {
        Ok(())
    }
}

/// The prompt to use in the example.
const PROMPT: &str = "You are an assistant that helps users explore, create and manage their documents. Use the available tools to create and read documents.";

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

    let document_storage_bucket =
        std::env::var("DOCUMENT_STORAGE_BUCKET").expect("DOCUMENT_STORAGE_BUCKET must be set");
    let docx_upload_bucket = std::env::var("DOCX_DOCUMENT_UPLOAD_BUCKET")
        .expect("DOCX_DOCUMENT_UPLOAD_BUCKET must be set");

    let s3_client = macro_aws_config::s3_client().await;
    let s3_upload_adapter =
        S3UploadUrlAdapter::new(s3_client, document_storage_bucket, docx_upload_bucket);

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
        s3_upload_adapter,
        NoOpTaskProperties,
        NoOpConnectionService,
    );

    let lexical_client = LexicalClient::new(sync_service_auth_key, lexical_service_url);

    let document_tool_context =
        DocumentToolContext::new(documents_service, entity_access_service, lexical_client);

    let toolset = document_toolset();

    let context = RequestContext {
        user_id,
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
