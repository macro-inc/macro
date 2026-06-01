#![recursion_limit = "256"]
use crate::api::context::ApiContext;
use ai_tools::{NoOpCallRtcClient, NoOpConnectionService, NoOpNotificationIngress};
use anyhow::Context;
use call::domain::service::{CallRecordQueryServiceImpl, CallServiceImpl};
use call::inbound::toolset::CallToolContext;
use call::outbound::pg_call_repo::PgCallRepo;
use call::outbound::s3_recording_storage::S3RecordingStorage;
use comms::domain::service::ChannelServiceImpl;
use comms::outbound::postgres::comms_repo::PgCommsRepo;
use comms::outbound::postgres::user_repo::PgUserRepo;
use config::{Config, EnvVars, Environment};
use document_storage_service_client::DocumentStorageServiceClient;
use documents::{
    domain::{models::CloudFrontConfig, service::DocumentServiceImpl},
    inbound::toolset::DocumentToolContext,
    outbound::{pg_document_repo::PgDocumentRepo, s3_upload_url::S3UploadUrlAdapter},
};
use email::domain::ports::ReadonlyEmailPreviewAdapter;
use email::domain::service::EmailServiceImpl;
use email::outbound::EmailPgRepo;
use email_service_client::{EmailServiceClient, EmailServiceClientExternal};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use foreign_entity::{
    domain::service::ForeignEntityServiceImpl,
    outbound::pg_foreign_entity_repo::PgForeignEntityRepo,
};
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::outbound::postgres::FrecencyPgStorage;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use notification::domain::service::{
    NotificationReaderService, PlatformArnConfig, SqsNotificationIngress,
};
use notification::outbound::queue::SqsQueue;
use notification::outbound::repository::DbNotificationRepository;
use readonly_pool::ReadOnlyPool;
use search_service_client::SearchServiceClient;
use secretsmanager_client::SecretManager;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use stream::outbound::redis_pg::RedisPostgresStreamRepo;
use sync_service_client::SyncServiceClient;

mod api;
mod config;
mod core;
mod model;
mod service;

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    // Parse our configuration from the environment.
    let config = Config::from_env(EnvVars::unwrap_new())
        .context("failed to parse config from environment")?;

    tracing::info!("initialized config");

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (5, 30),
        Environment::Develop => (3, 20),
        Environment::Local => (3, 10),
    };

    let db = PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(&config.database_url)
        .await
        .context("failed to connect to macrodb")?;

    tracing::info!(
        min_connections,
        max_connections,
        "initialized db connection"
    );

    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let dynamodb_client = aws_sdk_dynamodb::Client::new(&aws_config);
    let queue_aws_client = aws_sdk_sqs::Client::new(&aws_config);

    let sqs_client = sqs_client::SQS::new(queue_aws_client)
        .document_text_extractor_queue(&config.document_text_extractor_queue)
        .chat_delete_queue(&config.chat_delete_queue)
        .email_scheduled_queue(&config.email_scheduled_queue)
        .search_event_queue(&config.search_event_queue);

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    let internal_auth_key = secretsmanager_client::LocalOrRemoteSecret::Local(
        InternalApiSecretKey::new().context("failed to create internal auth key")?,
    );

    let document_storage_client = DocumentStorageServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.document_storage_service_url.clone(),
    );

    tracing::info!("initialized dss client");
    let sync_service_auth_key = match config.environment {
        Environment::Local => config.sync_service_auth_key.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.sync_service_auth_key)
            .await
            .context("failed to get sync service auth key from secrets manager")?
            .to_string(),
    };

    let sync_service_client = SyncServiceClient::new(
        sync_service_auth_key.clone(),
        config.sync_service_url.clone(),
    );

    tracing::info!("initialized sync service client");
    let search_service_client = SearchServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.document_storage_service_url.clone(),
    );

    tracing::info!("initialized search service client");
    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await
            .context("failed to create jwt validation args")?;

    let lexical_client = Arc::new(lexical_client::LexicalClient::new(
        internal_auth_key.as_ref().to_string(),
        config.lexical_service_url.clone(),
    ));

    let email_service_client = Arc::new(EmailServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.email_service_url.clone(),
    ));

    tracing::info!("initialized static file service client");

    // Initialize Redis client for stream service
    let redis_client = Arc::new(
        redis::Client::open(config.redis_host.as_ref())
            .inspect(|client| {
                client
                    .get_connection()
                    .map(|_| tracing::trace!("initialized redis connection"))
                    .inspect_err(|e| {
                        tracing::error!(error=?e, "failed to connect to redis");
                    })
                    .expect("redis connetion required");
            })
            .context("failed to connect to redis")?,
    );
    let stream_repo = RedisPostgresStreamRepo::new((*redis_client).clone(), db.clone()).obj();

    tracing::info!("initialized stream repo");

    let connection_manager =
        connection_gateway::service::dynamodb::create_dynamo_db_connection_manager(dynamodb_client)
            .await
            .context("failed to create connection manager")?;

    tracing::info!("initialized connection repo");

    let ingress_queue = SqsQueue::new(
        aws_sdk_sqs::Client::new(&aws_config),
        config.notification_queue.clone(),
    );
    let notification_ingress_service = Arc::new(SqsNotificationIngress {
        queue: ingress_queue,
    });

    let notification_reader_queue = SqsQueue::new(
        aws_sdk_sqs::Client::new(&aws_config),
        config.notification_queue.clone(),
    );
    let notification_reader_service = NotificationReaderService {
        repository: DbNotificationRepository::new(db.clone()),
        queue: ai_tools::ToolNotificationQueue::Sqs(notification_reader_queue),
        sns_endpoint: ai_tools::NoOpSnsEndpointManager,
        platform_config: PlatformArnConfig {
            apns_platform_arn: String::new(),
            fcm_platform_arn: String::new(),
            apns_voip_platform_arn: String::new(),
        },
        realtime: notification::domain::ports::NoopNotificationRealtimePublisher,
    };
    let notification_tool_context =
        notification::inbound::ai_tool::NotificationToolContext::new(notification_reader_service);

    tracing::info!("initialized notification ingress service");
    let entity_access_service = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        db.clone(),
    )));

    let frecency_storage = FrecencyPgStorage::new(db.clone());
    let frecency_service = FrecencyQueryServiceImpl::new(frecency_storage.clone());
    let crm_service = crm::domain::service::CrmServiceImpl::new(
        crm::outbound::companies_repo::CompaniesRepositoryImpl::new(db.clone()),
        crm::outbound::no_op_resolver::NoOpCompanyMetadataResolver,
    );
    let email_service = EmailServiceImpl::new(
        EmailPgRepo::new(db.clone()),
        frecency_service.clone(),
        email::domain::ports::NoOpEnqueuer,
        crm_service.clone(),
        0,
    );
    let channels_service = ChannelServiceImpl::new(
        PgCommsRepo::new(ReadOnlyPool(db.clone())),
        PgUserRepo::new(db.clone()),
        frecency_storage,
    );
    let email_service_for_tools: Arc<ai_tools::ToolEmailService> = Arc::new(email_service.clone());
    let foreign_entity_service =
        ForeignEntityServiceImpl::new(PgForeignEntityRepo::new(db.clone()));
    let soup_service = Arc::new(soup::domain::service::SoupImpl::new(
        soup::outbound::pg_soup_repo::PgSoupRepo::new(ReadOnlyPool(db.clone())),
        frecency_service,
        ReadonlyEmailPreviewAdapter(email_service),
        channels_service,
        call::domain::ports::NoOpCallRecordQueryService,
        crm::domain::service::NoOpCrmService,
        foreign_entity_service,
    ));

    tracing::info!("initialized soup service");

    let s3_client = macro_aws_config::s3_client().await;
    let s3_upload_adapter = S3UploadUrlAdapter::new(
        s3_client,
        config.document_storage_bucket.clone(),
        config.docx_document_upload_bucket.clone(),
    );
    let document_repo = PgDocumentRepo::new(db.clone());
    let cloudfront_private_key = match config.environment {
        Environment::Local => config.cloudfront_signer_private_key.replace("\\n", "\n"),
        _ => secretsmanager_client
            .get_secret_value(&config.cloudfront_signer_private_key)
            .await
            .context("failed to get CloudFront signer private key from secrets manager")?
            .to_string(),
    };
    let cloudfront_config = CloudFrontConfig {
        distribution_url: config.cloudfront_distribution_url.clone(),
        signer_public_key_id: config.cloudfront_signer_public_key_id.clone(),
        signer_private_key: cloudfront_private_key,
        presigned_url_expiry_seconds: 3600,
        browser_cache_expiry_seconds: 86400,
    };
    let properties_service =
        ai_tools::build_properties_service(db.clone(), entity_access_service.clone());
    let task_properties_service =
        ai_tools::build_task_properties_adapter(db.clone(), properties_service.clone());
    let document_service = DocumentServiceImpl::new(
        document_repo,
        cloudfront_config,
        sync_service_client.clone(),
        s3_upload_adapter,
        task_properties_service,
        NoOpConnectionService,
        entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
            entity_access_management::outbound::PgRepository::new(db.clone()),
        ),
    );
    let lexical_client_for_tools = (*lexical_client).clone();
    let document_tool_context = DocumentToolContext::new(
        document_service,
        (*entity_access_service).clone(),
        lexical_client_for_tools,
        sync_service_client.clone(),
    );

    tracing::info!("initialized document tool context");

    let attachment_provider = attachment::provider::AttachmentProvider {
        document: documents::inbound::attachment::DocumentAttachmentService::new(
            document_tool_context.service.clone(),
            document_tool_context.entity_access_service.clone(),
            document_tool_context.lexical_client.clone(),
        ),
        email_thread: email::inbound::attachment::EmailAttachmentService::new(
            email_service_for_tools.clone(),
            entity_access_service.clone(),
        ),
        chat: chat::inbound::attachment::ChatAttachmentService::new(
            Arc::new(chat::outbound::postgres::PgChatRepo::new(db.clone())),
            entity_access_service.clone(),
        ),
        channel: comms::inbound::attachment::CommsAttachmentService::new(
            Arc::new(PgCommsRepo::new(ReadOnlyPool(db.clone()))),
            entity_access_service.clone(),
        ),
        static_file: static_file::inbound::attachment::StaticFileAttachmentService::new(Arc::new(
            static_file::outbound::CdnStaticFileRepo::new(config.static_file_service_url.clone()),
        )),
    };
    let message_service = Arc::new(chat::domain::service::MessageServiceImpl::new(
        chat::outbound::postgres::PgChatRepo::new(db.clone()),
        attachment_provider,
    ));

    tracing::info!("initialized attachment provider");

    let email_service_client_external = Arc::new(EmailServiceClientExternal::new(
        email_service_client.url().to_owned(),
    ));

    let search_service_client = Arc::new(search_service_client);

    let properties_tool_context = ai_tools::build_properties_tool_context(properties_service);

    tracing::info!("initialized properties tool context");

    let email_tool_context = email::inbound::toolset::EmailToolContext::new(
        Arc::new(EmailServiceImpl::new(
            EmailPgRepo::new(db.clone()),
            FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(db.clone())),
            sqs_client.clone(),
            crm_service.clone(),
            0,
        )),
        Arc::new(email::domain::ports::NoOpGmailTokenProvider),
        Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
            db.clone(),
        ))),
    );

    tracing::info!("initialized email tool context");

    let call_service = CallServiceImpl::new(
        PgCallRepo::new(db.clone()),
        NoOpCallRtcClient,
        NoOpConnectionService,
        (*entity_access_service).clone(),
        NoOpNotificationIngress,
        None::<S3RecordingStorage>,
        String::new(),
    );
    let call_query_service = CallRecordQueryServiceImpl::new(PgCallRepo::new(db.clone()));
    let call_tool_context = CallToolContext::new(
        call_service,
        call_query_service,
        (*entity_access_service).clone(),
    );

    tracing::info!("initialized call tool context");

    let chat_tool_context = chat::inbound::toolset::ChatToolContext::new(
        chat::domain::service::ChatServiceImpl::new(
            chat::outbound::postgres::PgChatRepo::new(db.clone()),
            Arc::new(ai_toolset::AsyncToolCollection::new()),
            (),
            entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
                entity_access_management::outbound::PgRepository::new(db.clone()),
            ),
        ),
        (*entity_access_service).clone(),
    );

    tracing::info!("initialized chat tool context");

    let tool_service_context = ai_tools::ToolServiceContext {
        search_service_client: search_service_client.clone(),
        email_service_client: email_service_client_external.clone(),
        soup_service: soup_service.clone(),
        email_service: email_service_for_tools.clone(),
        document_tool_context: document_tool_context.clone(),
        properties_tool_context: properties_tool_context.clone(),
        email_tool_context: email_tool_context.clone(),
        call_tool_context: call_tool_context.clone(),
        notification_tool_context: notification_tool_context.clone(),
        chat_tool_context,
        channel_tool_context: ai_tools::build_channel_tool_context(db.clone()),
        team_tool_context: ai_tools::build_team_tool_context(db.clone()),
        schedule_tool_context: ai_tools::NoOpScheduleContext,
        anthropic_tool_context: ai_tools::build_anthropic_tool_context(),
    };
    let all_tools = ai_tools::all_tools();
    let all_tools_toolset = all_tools.toolset.clone();
    let all_tools_prompt = all_tools.prompt;

    // Build memory service
    let memory_repo = memory::outbound::pg_memory_repo::PgMemoryRepo::new(db.clone());
    let memory_service = Arc::new(memory::domain::service::MemoryServiceImpl::new(
        db.clone(),
        memory_repo,
        tool_service_context.clone(),
        all_tools,
    ));

    tracing::info!("initialized memory service");

    let mcp_credentials_key_b64 = match config.environment {
        Environment::Local => config.mcp_credentials_key_secret_name.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.mcp_credentials_key_secret_name)
            .await
            .context("failed to get MCP credentials key from secrets manager")?
            .to_string(),
    };
    let mcp_encryption_key =
        mcp_client::domain::models::AesKey::try_from(mcp_credentials_key_b64.as_str())
            .context("invalid MCP credentials encryption key")?;
    let mcp_server_repo =
        mcp_client::outbound::pg_server_repo::PgServerRepo::new(db.clone(), mcp_encryption_key);
    let mcp_redirect_uri = format!(
        "{}/mcp/servers/auth/callback",
        config.document_cognition_service_url
    );
    let mcp_oauth_state_store =
        mcp_client::outbound::redis_state_store::RedisOAuthStateStore::new(redis_client.clone());
    let mcp_pre_registered =
        mcp_client::domain::provider_registry::PreRegisteredProviders::from_env();
    let mcp_oauth = mcp_client::domain::service::OAuthService::new(
        mcp_server_repo.clone(),
        mcp_oauth_state_store,
        mcp_redirect_uri,
        mcp_pre_registered,
    );
    let mcp_state = mcp_client::inbound::McpRouterState::new(mcp_server_repo, mcp_oauth);

    api::setup_and_serve(ApiContext {
        db: db.clone(),
        email_service_client_external,
        sqs_client: Arc::new(sqs_client),
        document_storage_client: Arc::new(document_storage_client),
        search_service_client,
        jwt_args,
        config: Arc::new(config),
        internal_auth_key,
        notification_ingress_service,
        connection_repo: connection_manager.persistence,
        soup_service,
        email_service: email_service_for_tools,
        stream_repo,
        document_tool_context,
        memory_service,
        properties_tool_context,
        email_tool_context: email_tool_context.clone(),
        call_tool_context,
        tool_service_context,
        all_tools: all_tools_toolset,
        all_tools_prompt,
        entity_access_service,
        message_service,
        ai_stream_registry: service::ai_stream_registry::AiStreamRegistry::new(
            redis_client.clone(),
        ),
        mcp_state,
    })
    .await
    .context("failed to setup and serve api")?;
    Ok(())
}
