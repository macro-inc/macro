//! Builds a [`ToolServiceContext`] from environment variables.
//!
//! Services that host the AI tools (e.g. `memory`, `scheduled_action`) call
//! [`build_tool_service_context_from_env`] to wire up the shared context
//! instead of duplicating the wiring logic.

use crate::tool_context::{
    NoOpCallRtcClient, NoOpConnectionService, NoOpNotificationIngress, NoOpNotificationService,
    NoOpTaskProperties, ToolServiceContext,
};
use anyhow::Context;
use comms::domain::service::ChannelServiceImpl;
use comms::outbound::postgres::comms_repo::PgCommsRepo;
use comms::outbound::postgres::user_repo::PgUserRepo;
use documents::domain::models::CloudFrontConfig;
use documents::inbound::toolset::DocumentToolContext;
use documents::outbound::pg_document_repo::PgDocumentRepo;
use documents::outbound::s3_upload_url::S3UploadUrlAdapter;
use email::domain::ports::ReadonlyEmailPreviewAdapter;
use email::domain::service::EmailServiceImpl;
use email::outbound::EmailPgRepo;
use email_service_client::EmailServiceClientExternal;
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::outbound::postgres::FrecencyPgStorage;
use lexical_client::LexicalClient;
use macro_env::Environment;
use macro_env_var::{env_var, maybe_env_var};
use readonly_pool::ReadOnlyPool;
use search_service_client::SearchServiceClient;
use secretsmanager_client::{SecretManager, SecretsManager};
use soup::domain::service::SoupImpl;
use soup::outbound::pg_soup_repo::PgSoupRepo;
use std::sync::Arc;
use sync_service_client::SyncServiceClient;

env_var! {
    struct ToolContextEnvVars {
        DocumentStorageServiceUrl,
        SearchServiceUrl,
        EmailServiceUrl,
        SyncServiceUrl,
        SyncServiceAuthKey,
        StaticFileServiceUrl,
        DocumentStorageBucket,
        DocxDocumentUploadBucket,
        EmailScheduledQueue,
        DocumentStorageServiceCloudfrontDistributionUrl,
        DocumentStorageServiceCloudfrontSignerPublicKeyId,
        DocumentStorageServiceCloudfrontSignerPrivateKeySecretName,
    }
}

maybe_env_var! {
    struct ToolContextMaybeEnvVars {
        InternalApiSecretKey,
        LexicalServiceUrl,
    }
}

/// Builds a [`ToolServiceContext`] by reading the required environment
/// variables and wiring up all the shared services.
///
/// In `Develop` and `Production`, secret env vars (`SYNC_SERVICE_AUTH_KEY`
/// and `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME`)
/// are treated as AWS Secrets Manager secret names and resolved through the
/// secrets manager. In `Local`, their values are used directly.
///
/// Required env vars: `DOCUMENT_STORAGE_SERVICE_URL`,
/// `EMAIL_SERVICE_URL`, `SYNC_SERVICE_URL`, `SYNC_SERVICE_AUTH_KEY`,
/// `STATIC_FILE_SERVICE_URL`, `DOCUMENT_STORAGE_BUCKET`,
/// `DOCX_DOCUMENT_UPLOAD_BUCKET`, `EMAIL_SCHEDULED_QUEUE`,
/// `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL`,
/// `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID`,
/// `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME`.
///
/// Optional env vars (with fallbacks for local dev):
/// - `INTERNAL_API_SECRET_KEY` (defaults to `"local"`)
/// - `LEXICAL_SERVICE_URL` (defaults to `http://localhost:8096`)
#[tracing::instrument(skip(pool), err)]
pub async fn build_tool_service_context_from_env(
    pool: sqlx::PgPool,
) -> anyhow::Result<ToolServiceContext> {
    let env = ToolContextEnvVars::new()?;
    let maybe_env = ToolContextMaybeEnvVars::new();
    let environment = Environment::new_or_prod();

    let internal_api_secret_key: Arc<str> = maybe_env
        .internal_api_secret_key
        .map(|v| v.as_arc())
        .context("expected INTERNAL_API_SECRET_KEY")?;

    let lexical_service_url: Arc<str> = maybe_env
        .lexical_service_url
        .map(|v| v.as_arc())
        .context("expected LEXICAL_SERVICE_URL")?;

    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&aws_config))
        .email_scheduled_queue(&env.email_scheduled_queue);

    let secretsmanager_client =
        SecretsManager::new(aws_sdk_secretsmanager::Client::new(&aws_config));

    let sync_service_auth_key = secretsmanager_client
        .get_maybe_secret_value(environment, env.sync_service_auth_key.as_ref())
        .await
        .context("failed to get sync service auth key from secrets manager")?
        .as_ref()
        .to_string();

    let cloudfront_signer_private_key = secretsmanager_client
        .get_maybe_secret_value(
            environment,
            env.document_storage_service_cloudfront_signer_private_key_secret_name
                .as_ref(),
        )
        .await
        .context("failed to get CloudFront signer private key from secrets manager")?
        .as_ref()
        .to_string();

    let search_client = Arc::new(SearchServiceClient::new(
        internal_api_secret_key.to_string(),
        env.document_storage_service_url.to_string(),
    ));
    let sync_client = Arc::new(SyncServiceClient::new(
        sync_service_auth_key.clone(),
        env.sync_service_url.to_string(),
    ));
    let email_ext_client = Arc::new(EmailServiceClientExternal::new(
        env.email_service_url.to_string(),
    ));
    let lexical_client = LexicalClient::new(sync_service_auth_key, lexical_service_url.to_string());

    let frecency_storage = FrecencyPgStorage::new(pool.clone());
    let frecency_service = FrecencyQueryServiceImpl::new(frecency_storage.clone());
    let email_service = EmailServiceImpl::new(
        EmailPgRepo::new(pool.clone()),
        frecency_service.clone(),
        email::domain::ports::NoOpEnqueuer,
        0,
    );
    let channels_service = ChannelServiceImpl::new(
        PgCommsRepo::new(ReadOnlyPool(pool.clone())),
        PgUserRepo::new(pool.clone()),
        frecency_storage,
    );
    let channel_tool_context = crate::tool_context::build_channel_tool_context(pool.clone());
    let email_service_for_tools: Arc<crate::tool_context::ToolEmailService> =
        Arc::new(email_service.clone());
    let soup_service = Arc::new(SoupImpl::new(
        PgSoupRepo::new(ReadOnlyPool(pool.clone())),
        frecency_service,
        ReadonlyEmailPreviewAdapter(email_service),
        channels_service,
        call::domain::ports::NoOpCallRecordQueryService,
    ));

    let s3_client = macro_aws_config::s3_client().await;
    let s3_upload_adapter = S3UploadUrlAdapter::new(
        s3_client,
        env.document_storage_bucket.to_string(),
        env.docx_document_upload_bucket.to_string(),
    );
    let document_repo = PgDocumentRepo::new(pool.clone());
    let cloudfront_config = CloudFrontConfig {
        distribution_url: env
            .document_storage_service_cloudfront_distribution_url
            .to_string(),
        signer_public_key_id: env
            .document_storage_service_cloudfront_signer_public_key_id
            .to_string(),
        signer_private_key: cloudfront_signer_private_key,
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
        entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
            entity_access_management::outbound::PgRepository::new(pool.clone()),
        ),
    );
    let entity_access_service = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        pool.clone(),
    )));
    let document_tool_context = DocumentToolContext::new(
        document_service,
        (*entity_access_service).clone(),
        lexical_client,
    );

    let properties_service = properties::PropertiesServiceImpl::new(
        properties::PropertiesPgRepo::new(pool.clone()),
        Some(properties::PermissionServiceImpl::new(
            pool.clone(),
            entity_access_service.clone(),
        )),
        Some(NoOpNotificationService),
    );
    let properties_tool_context =
        properties::inbound::toolset::PropertiesToolContext::new(properties_service);

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

    let call_service = call::domain::service::CallServiceImpl::new(
        call::outbound::pg_call_repo::PgCallRepo::new(pool.clone()),
        NoOpCallRtcClient,
        NoOpConnectionService,
        (*entity_access_service).clone(),
        NoOpNotificationIngress,
        None::<call::outbound::s3_recording_storage::S3RecordingStorage>,
        String::new(),
    );
    let call_query_service = call::domain::service::CallRecordQueryServiceImpl::new(
        call::outbound::pg_call_repo::PgCallRepo::new(pool.clone()),
    );
    let call_tool_context = call::inbound::toolset::CallToolContext::new(
        call_service,
        call_query_service,
        (*entity_access_service).clone(),
    );

    let chat_repo = chat::outbound::postgres::PgChatRepo::new(pool.clone());
    let chat_service = chat::domain::service::ChatServiceImpl::new(
        chat_repo,
        Arc::new(ai_toolset::AsyncToolSet::new()),
        (),
        entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
            entity_access_management::outbound::PgRepository::new(pool.clone()),
        ),
    );
    let chat_tool_context = chat::inbound::toolset::ChatToolContext::new(
        chat_service,
        (*entity_access_service).clone(),
    );

    Ok(ToolServiceContext {
        search_service_client: search_client,
        email_service_client: email_ext_client,
        soup_service,
        email_service: email_service_for_tools,
        document_tool_context,
        properties_tool_context,
        email_tool_context,
        call_tool_context,
        chat_tool_context,
        channel_tool_context,
        schedule_tool_context: crate::NoOpScheduleContext,
    })
}
