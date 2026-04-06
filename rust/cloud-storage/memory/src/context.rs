use ai_tools::{
    NoOpConnectionService, NoOpNotificationService, NoOpTaskProperties, ToolServiceContext,
};
use comms::domain::service::ChannelServiceImpl;
use comms::outbound::postgres::comms_repo::PgCommsRepo;
use comms::outbound::postgres::user_repo::PgUserRepo;
use document_storage_service_client::DocumentStorageServiceClient;
use documents::domain::models::CloudFrontConfig;
use documents::inbound::toolset::DocumentToolContext;
use documents::outbound::pg_document_repo::PgDocumentRepo;
use documents::outbound::s3_upload_url::S3UploadUrlAdapter;
use email::domain::ports::ReadonlyEmailPreviewAdapter;
use email::domain::service::EmailServiceImpl;
use email::outbound::EmailPgRepo;
use email_service_client::{EmailServiceClient, EmailServiceClientExternal};
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::outbound::postgres::FrecencyPgStorage;
use lexical_client::LexicalClient;
use scribe::ScribeClient;
use scribe::document::DocumentClient;
use search_service_client::SearchServiceClient;
use soup::domain::service::SoupImpl;
use soup::outbound::pg_soup_repo::PgSoupRepo;
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;
use sync_service_client::SyncServiceClient;

/// Builds a [`ToolServiceContext`] from environment variables and a database pool.
///
/// Required env vars: `INTERNAL_API_SECRET_KEY`, `DOCUMENT_STORAGE_SERVICE_URL`,
/// `SEARCH_SERVICE_URL`, `EMAIL_SERVICE_URL`, `SYNC_SERVICE_URL`,
/// `DOCUMENT_COGNITION_SERVICE_URL`, `STATIC_FILE_SERVICE_URL`,
/// `DOCUMENT_STORAGE_BUCKET`, `DOCX_DOCUMENT_UPLOAD_BUCKET`,
/// `EMAIL_SCHEDULED_QUEUE`,
/// `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL`,
/// `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID`,
/// `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME`
#[tracing::instrument(skip(pool), err)]
pub async fn build_tool_service_context(pool: sqlx::PgPool) -> anyhow::Result<ToolServiceContext> {
    let internal_auth_key =
        std::env::var("INTERNAL_API_SECRET_KEY").unwrap_or_else(|_| "local".into());
    let dss_url = std::env::var("DOCUMENT_STORAGE_SERVICE_URL")?;
    let search_url = std::env::var("SEARCH_SERVICE_URL")?;
    let email_url = std::env::var("EMAIL_SERVICE_URL")?;
    let sync_url = std::env::var("SYNC_SERVICE_URL")?;
    let sfs_url = std::env::var("STATIC_FILE_SERVICE_URL")?;
    let lexical_url =
        std::env::var("LEXICAL_SERVICE_URL").unwrap_or_else(|_| "http://localhost:8096".into());
    let doc_bucket = std::env::var("DOCUMENT_STORAGE_BUCKET")?;
    let docx_bucket = std::env::var("DOCX_DOCUMENT_UPLOAD_BUCKET")?;
    let email_scheduled_queue = std::env::var("EMAIL_SCHEDULED_QUEUE")?;
    let cf_dist_url = std::env::var("DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL")?;
    let cf_key_id = std::env::var("DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID")?;
    let cf_private_key =
        std::env::var("DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME")?;
    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&aws_config))
        .email_scheduled_queue(&email_scheduled_queue);

    // Service clients
    let dss_client = Arc::new(DocumentStorageServiceClient::new(
        internal_auth_key.clone(),
        dss_url,
    ));
    let search_client = Arc::new(SearchServiceClient::new(
        internal_auth_key.clone(),
        search_url,
    ));
    let sync_client = Arc::new(SyncServiceClient::new(internal_auth_key.clone(), sync_url));
    let email_client = Arc::new(EmailServiceClient::new(
        internal_auth_key.clone(),
        email_url.clone(),
    ));
    let sfs_client = Arc::new(StaticFileServiceClient::new(
        internal_auth_key.clone(),
        sfs_url,
    ));
    let email_ext_client = Arc::new(EmailServiceClientExternal::new(email_url));
    let lexical_client = LexicalClient::new(internal_auth_key, lexical_url);

    // Scribe
    let scribe = Arc::new(
        ScribeClient::new()
            .with_document_client(
                DocumentClient::builder()
                    .with_dss_client(dss_client.clone())
                    .with_lexical_client(Arc::new(lexical_client.clone()))
                    .with_sync_service_client(sync_client.clone())
                    .with_macro_db(pool.clone())
                    .build(),
            )
            .with_channel_client(pool.clone())
            .with_dcs_client(pool.clone())
            .with_email_client(email_client)
            .with_static_file_client(sfs_client),
    );

    // Soup service
    let frecency_storage = FrecencyPgStorage::new(pool.clone());
    let frecency_service = FrecencyQueryServiceImpl::new(frecency_storage.clone());
    let email_service = EmailServiceImpl::new(
        EmailPgRepo::new(pool.clone()),
        frecency_service.clone(),
        email::domain::ports::NoOpEnqueuer,
        0,
    );
    let channels_service = ChannelServiceImpl::new(
        PgCommsRepo::new(readonly_pool::ReadOnlyPool(pool.clone())),
        PgUserRepo::new(pool.clone()),
        frecency_storage,
    );
    let email_service_for_tools: Arc<ai_tools::ToolEmailService> = Arc::new(email_service.clone());
    let soup_service = Arc::new(SoupImpl::new(
        PgSoupRepo::new(readonly_pool::ReadOnlyPool(pool.clone())),
        frecency_service,
        ReadonlyEmailPreviewAdapter(email_service),
        channels_service,
    ));

    // Document tool context
    let s3_client = macro_aws_config::s3_client().await;
    let s3_upload_adapter = S3UploadUrlAdapter::new(s3_client, &doc_bucket, &docx_bucket);
    let document_repo = PgDocumentRepo::new(pool.clone());
    let cloudfront_config = CloudFrontConfig {
        distribution_url: cf_dist_url,
        signer_public_key_id: cf_key_id,
        signer_private_key: cf_private_key,
        presigned_url_expiry_seconds: 3600,
        browser_cache_expiry_seconds: 86400,
    };
    let document_service = documents::domain::service::DocumentServiceImpl::new(
        document_repo,
        cloudfront_config,
        sync_client.as_ref().clone(),
        s3_upload_adapter,
        NoOpTaskProperties,
        NoOpConnectionService,
    );
    let entity_access_service = EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone()));
    let document_tool_context =
        DocumentToolContext::new(document_service, entity_access_service, lexical_client);

    // Properties tool context
    let properties_service = properties::PropertiesServiceImpl::new(
        properties::PropertiesPgRepo::new(pool.clone()),
        Some(properties::PermissionServiceImpl::new(pool.clone())),
        Some(NoOpNotificationService),
    );
    let properties_tool_context =
        properties::inbound::toolset::PropertiesToolContext::new(properties_service);

    // Email tool context
    let email_tool_context = email::inbound::toolset::EmailToolContext::new(
        Arc::new(EmailServiceImpl::new(
            EmailPgRepo::new(pool.clone()),
            FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(pool.clone())),
            sqs_client,
            0,
        )),
        Arc::new(email::domain::ports::NoOpGmailTokenProvider),
        Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
            pool.clone(),
        ))),
    );

    Ok(ToolServiceContext {
        search_service_client: search_client,
        email_service_client: email_ext_client,
        scribe,
        soup_service,
        email_service: email_service_for_tools,
        document_tool_context,
        properties_tool_context,
        email_tool_context,
    })
}
