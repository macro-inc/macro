use ai_tools::{
    NoOpCallRtcClient, NoOpConnectionService, NoOpNotificationIngress, NoOpNotificationService,
    NoOpScheduleContext, NoOpSnsEndpointManager, NoOpTaskProperties, ToolNotificationQueue,
    ToolServiceContext,
};
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
use notification::domain::service::{NotificationReaderService, PlatformArnConfig};
use notification::outbound::repository::DbNotificationRepository;
use search_service_client::SearchServiceClient;
use soup::domain::service::SoupImpl;
use soup::outbound::pg_soup_repo::PgSoupRepo;
use std::sync::Arc;
use sync_service_client::SyncServiceClient;

use crate::config::Config;

/// Builds a [`ToolServiceContext`] from environment variables and a database pool.
///
/// Required env vars: `INTERNAL_API_SECRET_KEY`, `DOCUMENT_STORAGE_SERVICE_URL`,
/// `EMAIL_SERVICE_URL`, `SYNC_SERVICE_URL`,
/// `DOCUMENT_COGNITION_SERVICE_URL`, `STATIC_FILE_SERVICE_URL`,
/// `DOCUMENT_STORAGE_BUCKET`, `DOCX_DOCUMENT_UPLOAD_BUCKET`,
/// `EMAIL_SCHEDULED_QUEUE`,
/// `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL`,
/// `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID`,
/// `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME`
#[tracing::instrument(skip(pool, config), err)]
pub async fn build_tool_service_context(
    pool: sqlx::PgPool,
    config: &Config,
) -> anyhow::Result<ToolServiceContext> {
    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&aws_config))
        .email_scheduled_queue(&config.email_scheduled_queue);

    // Service clients
    let search_client = Arc::new(SearchServiceClient::new(
        config.internal_api_secret_key.clone(),
        config.document_storage_service_url.clone(),
    ));
    let sync_client = Arc::new(SyncServiceClient::new(
        config.internal_api_secret_key.clone(),
        config.sync_service_url.clone(),
    ));
    let email_ext_client = Arc::new(EmailServiceClientExternal::new(
        config.email_service_url.clone(),
    ));
    let lexical_client = LexicalClient::new(
        config.internal_api_secret_key.clone(),
        config.lexical_service_url.clone(),
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
        call::domain::ports::NoOpCallRecordQueryService,
    ));

    // Document tool context
    let s3_client = macro_aws_config::s3_client().await;
    let s3_upload_adapter = S3UploadUrlAdapter::new(
        s3_client,
        &config.document_storage_bucket,
        &config.docx_document_upload_bucket,
    );
    let document_repo = PgDocumentRepo::new(pool.clone());
    let cloudfront_config = CloudFrontConfig {
        distribution_url: config
            .document_storage_service_cloudfront_distribution_url
            .clone(),
        signer_public_key_id: config
            .document_storage_service_cloudfront_signer_public_key_id
            .clone(),
        signer_private_key: config
            .document_storage_service_cloudfront_signer_private_key_secret_name
            .clone(),
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
    let entity_access_service = EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone()));
    let entity_access_service = Arc::new(entity_access_service);
    let document_tool_context = DocumentToolContext::new(
        document_service,
        (*entity_access_service).clone(),
        lexical_client,
        sync_client.as_ref().clone(),
    );

    // Properties tool context
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

    let call_service = call::domain::service::CallServiceImpl::new(
        call::outbound::pg_call_repo::PgCallRepo::new(pool.clone()),
        ai_tools::NoOpCallRtcClient,
        ai_tools::NoOpConnectionService,
        (*entity_access_service).clone(),
        ai_tools::NoOpNotificationIngress,
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

    let notification_reader_service = NotificationReaderService::new(
        DbNotificationRepository::new(pool.clone()),
        ToolNotificationQueue::NoOp,
        NoOpSnsEndpointManager,
        PlatformArnConfig {
            apns_platform_arn: String::new(),
            fcm_platform_arn: String::new(),
            apns_voip_platform_arn: String::new(),
        },
    );
    let notification_tool_context =
        notification::inbound::ai_tool::NotificationToolContext::new(notification_reader_service);

    let chat_tool_context = chat::inbound::toolset::ChatToolContext::new(
        chat::domain::service::ChatServiceImpl::new(
            chat::outbound::postgres::PgChatRepo::new(pool.clone()),
            Arc::new(ai_toolset::AsyncToolCollection::new()),
            (),
            entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
                entity_access_management::outbound::PgRepository::new(pool.clone()),
            ),
        ),
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
        notification_tool_context,
        chat_tool_context,
        channel_tool_context: ai_tools::build_channel_tool_context(pool.clone()),
        schedule_tool_context: ai_tools::NoOpScheduleContext,
    })
}
