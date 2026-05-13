use anyhow::Context as _;
use documents::outbound::markdown_init::LexicalSyncMarkdownInitializer;
use documents::outbound::pg_document_repo::PgDocumentRepo;
use lexical_client::LexicalClient;
use sqlx::postgres::PgPoolOptions;
use sync_service_client::SyncServiceClient;

use crate::app::{DocumentUploadFinalizer, ObjectCreated};
use crate::outbound::{PgDocumentUploadPort, S3DocumentObjectReader};

/// Concrete app context used by Lambda and local worker entrypoints.
pub struct AppContext {
    finalizer: DocumentUploadFinalizer<PgDocumentUploadPort, S3DocumentObjectReader>,
    lexical_client: LexicalClient,
    sync_service_client: SyncServiceClient,
}

impl AppContext {
    /// Build the shared finalizer context from environment variables.
    pub async fn from_env() -> Result<Self, anyhow::Error> {
        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;
        let internal_api_secret = std::env::var("INTERNAL_API_SECRET_KEY")
            .context("INTERNAL_API_SECRET_KEY must be provided")?;
        let sync_service_auth_key = std::env::var("SYNC_SERVICE_AUTH_KEY")
            .context("SYNC_SERVICE_AUTH_KEY must be provided")?;
        let lexical_service_url =
            std::env::var("LEXICAL_SERVICE_URL").context("LEXICAL_SERVICE_URL must be provided")?;
        let sync_service_url =
            std::env::var("SYNC_SERVICE_URL").context("SYNC_SERVICE_URL must be provided")?;

        let db_pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .context("failed to connect to postgres")?;

        let repo = PgDocumentRepo::new(db_pool);
        let document_port = PgDocumentUploadPort::new(repo);
        let object_reader = S3DocumentObjectReader::new(macro_aws_config::s3_client().await);
        let finalizer = DocumentUploadFinalizer::new(document_port, object_reader);

        Ok(Self {
            finalizer,
            lexical_client: LexicalClient::new(internal_api_secret, lexical_service_url),
            sync_service_client: SyncServiceClient::new(sync_service_auth_key, sync_service_url),
        })
    }

    /// Handle one normalized object-created event.
    pub async fn handle_object_created(&self, event: ObjectCreated) -> Result<(), anyhow::Error> {
        let markdown_initializer = LexicalSyncMarkdownInitializer::new(
            self.lexical_client.clone(),
            self.sync_service_client.clone(),
        );

        self.finalizer
            .handle_object_created(event, &markdown_initializer)
            .await
    }
}
