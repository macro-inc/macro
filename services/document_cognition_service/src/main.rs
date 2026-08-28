#![recursion_limit = "256"]
use crate::api::context::ApiContext;
use ai_tools::{NoOpCallRtcClient, NoOpConnectionService, NoOpNotificationIngress};
use anyhow::Context;
use call::domain::service::{CallRecordQueryServiceImpl, CallServiceImpl};
use call::inbound::toolset::CallToolContext;
use call::outbound::pg_call_repo::PgCallRepo;
use call::outbound::s3_recording_storage::S3RecordingStorage;
use channels::{
    domain::list_service::ChannelListServiceImpl, outbound::pg_channels_repo::PgChannelsRepo,
};
use config::{Config, Environment};
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
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState,
};
use macro_entrypoint::MacroEntrypoint;
use macro_service_urls::{
    ConnectionGatewayUrl, DocumentStorageServiceUrl, EmailServiceUrl, LexicalServiceUrl,
    StaticFileServiceUrl, SyncServiceUrl,
};
use notification::domain::service::{
    NotificationReaderService, PlatformArnConfig, SqsNotificationIngress,
};
use notification::outbound::queue::SqsQueue;
use notification::outbound::repository::DbNotificationRepository;
use notification::outbound::websocket::ConnectionGatewayClient;
use readonly_pool::ReadOnlyPool;
use search_service_client::SearchServiceClient;
use sqlx::postgres::PgPoolOptions;
use std::{sync::Arc, time::Duration};
use stream::outbound::redis_pg::RedisPostgresStreamRepo;
use sync_service_client::SyncServiceClient;
use tokio_util::task::TaskTracker;

mod api;
mod config;
mod core;
mod model;
mod service;

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let aws_config = macro_aws_config::get_macro_aws_config().await;

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    // Parse our configuration from the environment.
    let config = Config::from_env()
        .context("expected to be able to generate config")?
        .resolve_remote_secrets(Environment::new_or_prod(), &secretsmanager_client)
        .await
        .context("expected to be able to resolve config secrets")?;

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

    let dynamodb_client = aws_sdk_dynamodb::Client::new(&aws_config);
    let queue_aws_client = aws_sdk_sqs::Client::new(&aws_config);

    let document_text_extractor_queue = macro_queues::DocumentTextExtractorQueue::new();
    let chat_delete_queue = macro_queues::ChatDeleteQueue::new();
    let email_scheduled_queue = macro_queues::EmailScheduledQueue::new();
    let gmail_ops_queue = macro_queues::GmailOpsQueue::new();
    let ai_projection_queue = macro_queues::AiProjectionQueue::new();
    let notification_queue = macro_queues::NotificationIngressQueue::new();
    let sqs_client = sqs_client::SQS::new(queue_aws_client)
        .document_text_extractor_queue(&document_text_extractor_queue)
        .chat_delete_queue(&chat_delete_queue)
        .email_scheduled_queue(&email_scheduled_queue)
        .gmail_ops_queue(&gmail_ops_queue)
        .ai_projection_queue(&ai_projection_queue);

    let internal_api_key = config.internal_api_key.to_string();

    let document_storage_client = DocumentStorageServiceClient::new(
        config
            .document_storage_service_auth_key
            .as_ref()
            .to_string(),
        DocumentStorageServiceUrl::new()?.to_string(),
    );

    tracing::info!("initialized dss client");

    let sync_service_client = SyncServiceClient::new(
        config.sync_service_auth_key.as_ref().to_string(),
        SyncServiceUrl::new()?.to_string(),
    );
    tracing::info!("initialized sync service client");

    let search_service_client = SearchServiceClient::new(
        config
            .document_storage_service_auth_key
            .as_ref()
            .to_string(),
        DocumentStorageServiceUrl::new()?.to_string(),
    );
    tracing::info!("initialized search service client");

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await
            .context("failed to create jwt validation args")?;

    let authorization_state =
        MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
            MacroAuthJwtValidator::new(jwt_args),
            InternalAuthConfig {
                api_key: internal_api_key.clone(),
                default_user_id: None,
            },
            macro_authorization::NoBotAuthorizer,
        )));

    let lexical_client = Arc::new(lexical_client::LexicalClient::new(
        internal_api_key.clone(),
        LexicalServiceUrl::new()?.to_string(),
    ));

    let email_service_client = Arc::new(EmailServiceClient::new(
        internal_api_key.clone(),
        EmailServiceUrl::new()?.to_string(),
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
    let connection_gateway_client = Arc::new(ConnectionGatewayClient::new(
        internal_api_key.clone(),
        ConnectionGatewayUrl::new()?.to_string(),
    ));

    let ingress_queue = SqsQueue::new(
        aws_sdk_sqs::Client::new(&aws_config),
        notification_queue.to_string(),
    );
    let notification_ingress_service = Arc::new(SqsNotificationIngress {
        queue: ingress_queue,
    });

    let notification_reader_queue = SqsQueue::new(
        aws_sdk_sqs::Client::new(&aws_config),
        notification_queue.to_string(),
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
        entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
            entity_access_management::outbound::PgRepository::new(db.clone()),
        ),
        0,
    );
    let channels_service = ChannelListServiceImpl::new(
        PgChannelsRepo::new(db.clone()),
        PgChannelsRepo::new(db.clone()),
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
        CallRecordQueryServiceImpl::new(PgCallRepo::new(db.clone())),
        crm::domain::service::NoOpCrmService,
        foreign_entity_service,
        reminders::domain::service::NoOpRemindersService,
    ));

    tracing::info!("initialized soup service");

    let s3_client = macro_aws_config::s3_client().await;
    let s3_upload_adapter = S3UploadUrlAdapter::new(
        s3_client,
        config.document_storage_bucket.to_string(),
        config.docx_document_upload_bucket.to_string(),
    );
    let document_repo = PgDocumentRepo::new(db.clone());

    let cloudfront_config = CloudFrontConfig {
        distribution_url: config
            .document_storage_service_cloudfront_distribution_url
            .to_string(),
        signer_public_key_id: config
            .document_storage_service_cloudfront_signer_public_key_id
            .to_string(),
        signer_private_key: config
            .document_storage_service_cloudfront_signer_private_key
            .as_ref()
            .to_string(),
        presigned_url_expiry_seconds: 3600,
        browser_cache_expiry_seconds: 86400,
    };
    let properties_service =
        ai_tools::build_properties_service(db.clone(), entity_access_service.clone());
    let task_properties_service = ai_tools::build_task_properties_adapter(
        db.clone(),
        properties_service.clone(),
        entity_access_service.clone(),
    );
    // The import pipeline sets the same task system properties on imported
    // Linear issues (status, priority, due date, assignee).
    let task_properties_for_import = task_properties_service.clone();
    let document_properties_for_import =
        import::outbound::document_properties::DocumentPropertiesApplicator::new(
            properties_service.clone(),
        );
    let event_broker_tracker = TaskTracker::new();
    let macro_event_broker = macro_event_broker::MacroEventBrokerService::new(
        macro_event_broker::KafkaEventPublisher::new(config.kafka_brokers.as_ref())
            .context("failed to create kafka event publisher")?,
        event_broker_tracker.clone(),
    );
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
        ForeignEntityServiceImpl::new(PgForeignEntityRepo::new(db.clone())),
        macro_event_broker.clone(),
    );
    let lexical_client_for_tools = (*lexical_client).clone();
    let document_tool_context = DocumentToolContext::new(
        document_service,
        (*entity_access_service).clone(),
        lexical_client_for_tools,
        sync_service_client.clone(),
        documents::outbound::editing_worker_client::ReqwestEditingWorkerClient::new(
            config.ai_editing_worker_url.clone(),
            std::sync::Arc::new(reqwest::Client::new()),
        ),
        config.document_permission_jwt.as_ref().to_string(),
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
        channel: channels::inbound::attachment::ChannelAttachmentService::new(
            Arc::new(PgChannelsRepo::new(db.clone())),
            entity_access_service.clone(),
        ),
        static_file: static_file::inbound::attachment::StaticFileAttachmentService::new(Arc::new(
            static_file::outbound::CdnStaticFileRepo::new(StaticFileServiceUrl::new()?.to_string()),
        )),
    };
    let message_service = Arc::new(
        chat::domain::service::MessageServiceImpl::new(
            chat::outbound::postgres::PgChatRepo::new(db.clone()),
            attachment_provider,
        )
        .with_event_broker(macro_event_broker.clone()),
    );

    tracing::info!("initialized attachment provider");

    let email_service_client_external = Arc::new(EmailServiceClientExternal::new(
        email_service_client.url().to_owned(),
    ));

    let search_service_client = Arc::new(search_service_client);

    let properties_tool_context = ai_tools::build_properties_tool_context(
        properties_service.clone(),
        entity_access_service.clone(),
    );

    tracing::info!("initialized properties tool context");

    let user_email_service = Arc::new(
        EmailServiceImpl::new(
            EmailPgRepo::new(db.clone()),
            FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(db.clone())),
            sqs_client.clone(),
            crm_service.clone(),
            entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
                entity_access_management::outbound::PgRepository::new(db.clone()),
            ),
            0,
        )
        .with_macro_event_broker(macro_event_broker.clone()),
    );
    let email_tool_context = email::inbound::toolset::EmailToolContext::new(
        user_email_service.clone(),
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
    let call_tool_context = CallToolContext::new(call_service, (*entity_access_service).clone());

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

    // Channel messages sent by AI tools (chat, agents) dispatch the same side
    // effects as the document-storage channel API, so mentions and replies
    // notify recipients and stream to connected clients.
    let channels_connection_gateway =
        Arc::new(connection_gateway_client::ConnectionGatewayClient::new(
            internal_api_key.clone(),
            ConnectionGatewayUrl::new()?.to_string(),
        ));
    let channel_tool_context = ai_tools::build_channel_tool_context_with_side_effects(
        db.clone(),
        lexical_client.clone(),
        ai_tools::ChannelSideEffectClients {
            connection_gateway: channels_connection_gateway.clone(),
            sqs: aws_sdk_sqs::Client::new(&aws_config),
            macro_event_broker: macro_event_broker.clone(),
        },
    );
    let recorder = ai_usage::pg_recorder(db.clone());

    // The import pipeline: staged/imported external items, gather jobs over
    // the user's connectors, and the Haiku import job. Built before the tool
    // service context so the chat toolset gets a wired import context.
    let mcp_encryption_key = mcp_client::domain::models::AesKey::try_from(
        config.mcp_credentials_key_secret_name.as_ref(),
    )
    .context("invalid MCP credentials encryption key")?;
    let mcp_server_repo =
        mcp_client::outbound::pg_server_repo::PgServerRepo::new(db.clone(), mcp_encryption_key);

    // The Pipedream MCP stack, fully separate from the native one above
    // (own endpoints, own table, own toolset). Without credentials its
    // endpoints answer 501 and its toolsets come up empty.
    let pipedream_client: ai_tools::ToolPipedreamConnection = match (
        config.pipedream_client_id.value(),
        config.pipedream_client_secret.value(),
        config.pipedream_project_id.value(),
    ) {
        (Some(client_id), Some(client_secret), Some(project_id)) => Some(Arc::new(
            pipedream_mcp::outbound::api::PipedreamClient::new(
                pipedream_mcp::outbound::api::PipedreamConfig {
                    client_id: client_id.to_owned(),
                    client_secret: client_secret.to_owned(),
                    project_id: project_id.to_owned(),
                    environment: config
                        .pipedream_environment
                        .value()
                        .unwrap_or(match config.environment {
                            Environment::Production => "production",
                            _ => "development",
                        })
                        .to_owned(),
                    api_url: config
                        .pipedream_api_url
                        .value()
                        .unwrap_or(pipedream_mcp::outbound::api::DEFAULT_API_URL)
                        .to_owned(),
                    mcp_url: config
                        .pipedream_mcp_url
                        .value()
                        .unwrap_or(pipedream_mcp::outbound::api::DEFAULT_MCP_URL)
                        .to_owned(),
                    allowed_origins: match config.pipedream_allowed_origins.value() {
                        Some(origins) => origins
                            .split(',')
                            .map(|origin| origin.trim().to_owned())
                            .filter(|origin| !origin.is_empty())
                            .collect(),
                        None => match config.environment {
                            Environment::Production => vec!["https://macro.com".to_owned()],
                            Environment::Develop => vec![
                                "https://dev.macro.com".to_owned(),
                                "http://localhost:3000".to_owned(),
                            ],
                            Environment::Local => vec!["http://localhost:3000".to_owned()],
                        },
                    },
                },
            )
            .context("failed to build Pipedream client")?,
        )),
        _ => {
            tracing::info!("Pipedream credentials not set; Pipedream MCP connectors disabled");
            None
        }
    };
    let pipedream_repo =
        pipedream_mcp::outbound::pg_connection_repo::PgConnectionRepo::new(db.clone());

    // The one sanctioned meeting point of the two MCP stacks: agents load
    // tools through this selector, which prefers a user's Pipedream
    // connectors and falls back to the native ones (see `mcp_select`).
    let mcp_selector: Arc<ai_tools::ToolMcpSelector> = Arc::new(mcp_select::McpToolSelector::new(
        Arc::new(mcp_server_repo.clone()),
        Arc::new(pipedream_repo.clone()),
        Arc::new(pipedream_client.clone()),
    ));

    // Nudges the user's connected clients when import rows flip, so setup
    // sections and chat surfaces update immediately instead of on the next
    // poll (see import::outbound::gateway_notifier).
    let import_notify =
        import::outbound::gateway_notifier::gateway_import_notify(channels_connection_gateway);

    let entity_creator = ai_tools::ToolEntityCreator {
        document_creator: document_tool_context.creator.clone(),
        entity_access_service: entity_access_service.clone(),
        channel_service: channel_tool_context.service.clone(),
        task_properties: task_properties_for_import,
        document_properties: document_properties_for_import,
        team_repository: ai_tools::build_team_repository(db.clone()),
    };
    let import_service = Arc::new(
        import::domain::service::ImportServiceImpl::new(
            import::outbound::pg_import_repo::PgImportRepo::new(db.clone()),
            mcp_selector.clone(),
            Arc::new(entity_creator),
            recorder.clone(),
        )
        .with_notifier(import_notify),
    );

    // No boot-time recovery: running batches heartbeat their rows, and the
    // read path reaps rows whose heartbeat stopped — safe with multiple
    // replicas, where a boot-time sweep would clobber other instances' jobs.
    tracing::info!("initialized import service");

    let project_tool_context = ai_tools::build_project_tool_context(
        db.clone(),
        macro_event_broker.clone(),
        entity_access_service.clone(),
        document_tool_context.service.clone(),
        chat_tool_context.service.clone(),
        user_email_service,
    );

    let tool_service_context = ai_tools::ToolServiceContext {
        search_service_client: search_service_client.clone(),
        email_service_client: email_service_client_external.clone(),
        soup_service: soup_service.clone(),
        email_service: email_service_for_tools.clone(),
        activity_tool_context: ai_tools::build_activity_tool_context(
            db.clone(),
            properties_service,
            entity_access_service.clone(),
        ),
        document_tool_context: document_tool_context.clone(),
        properties_tool_context: properties_tool_context.clone(),
        email_tool_context: email_tool_context.clone(),
        call_tool_context: call_tool_context.clone(),
        calendar_tool_context: ai_tools::build_calendar_tool_context(
            db.clone(),
            EmailServiceUrl::new()?.to_string(),
            internal_api_key.clone(),
        ),
        notification_tool_context: notification_tool_context.clone(),
        reminders_tool_context: ai_tools::build_reminders_tool_context(
            db.clone(),
            entity_access_service.clone(),
        ),
        import_tool_context: import::inbound::toolset::ImportToolContext::wired(
            import_service.clone(),
        ),
        chat_tool_context,
        channel_tool_context,
        bot_tool_context: ai_tools::build_bot_tool_context(
            db.clone(),
            ai_tools::ToolBotEventBroker::Real(macro_event_broker.clone()),
            entity_access_service.clone(),
            DocumentStorageServiceUrl::new()?.to_string(),
        ),
        project_tool_context,
        team_tool_context: ai_tools::build_team_tool_context(db.clone()),
        crm_tool_context: ai_tools::build_crm_tool_context(db.clone()),
        skill_tool_context: ai_tools::build_skill_tool_context(
            search_service_client.clone(),
            soup_service.clone(),
        ),
        schedule_tool_context: ai_tools::NoOpScheduleContext,
        anthropic_tool_context: ai_tools::build_anthropic_tool_context(),
        recorder,
        usage_context: ai_usage::UsageContext::system(ai_usage::AiFeature::Chat),
    };
    let all_tools = ai_tools::all_tools();
    let all_tools_toolset = all_tools.toolset.clone();
    let all_tools_prompt: Arc<dyn std::fmt::Display + Send + Sync> =
        Arc::new(all_tools.prompt.to_string());

    // Build memory service
    let memory_repo = memory::outbound::pg_memory_repo::PgMemoryRepo::new(db.clone());
    let memory_service = Arc::new(memory::domain::service::MemoryServiceImpl::new(
        memory_repo,
        tool_service_context.clone(),
        all_tools,
    ));

    tracing::info!("initialized memory service");

    // Build the AI cost service. It backs both the admin query/pricing router
    // and the usage recorder threaded through the tool service context.
    let usage_service = Arc::new(ai_usage::domain::service::UsageServiceImpl::new(
        ai_usage::outbound::PgUsageRepo::new(db.clone()),
    ));

    tracing::info!("initialized ai cost service");

    // Generator that materializes projections by running their prompt through
    // the shared AI toolset, attributed to the requesting user.
    let projection_generator =
        ai_projections::outbound::agent_generator::AgentProjectionGenerator::new(
            tool_service_context.clone(),
            ai_tools::all_tools(),
        );
    // Notifier that pushes finished materializations to the target's connected
    // clients through the connection gateway.
    let projection_notifier =
        ai_projections::outbound::gateway_notifier::GatewayProjectionNotifier::new(Arc::new(
            connection_gateway_client::ConnectionGatewayClient::new(
                internal_api_key.clone(),
                ConnectionGatewayUrl::new()?.to_string(),
            ),
        ));
    let ai_projections_service_impl =
        ai_projections::domain::ai_projection_service::AiProjectionServiceImpl::new(
            ai_projections::outbound::ai_projection_repo::AiProjectionRepositoryImpl::new(
                db.clone(),
            ),
            sqs_client.clone(),
            projection_generator,
            projection_notifier,
        );

    // Spawn the inbound worker that polls ai_projection_queue and materializes
    // projection instances. It owns its own clone of the service.
    let ai_projection_worker = ai_projections::worker::AiProjectionWorker::new(
        sqs_worker::SQSWorker::new(
            aws_sdk_sqs::Client::new(&aws_config),
            ai_projection_queue.to_string(),
            10,
            10,
        ),
        ai_projections_service_impl.clone(),
    );
    let ai_projection_worker_task = tokio::spawn(async move {
        ai_projection_worker.poll().await;
    });

    let ai_projections_service = Arc::new(ai_projections_service_impl);

    tracing::info!("initialized ai projections service");

    // The onboarding flow drives the import pipeline: reads/hooks start
    // auto-importing gather runs for authenticated connectors, and
    // completion deletes unreserved onboarding-staged candidates.
    let onboarding_service = Arc::new(onboarding::domain::service::OnboardingServiceImpl::new(
        onboarding::outbound::pg_onboarding_repo::PgOnboardingRepo::new(db.clone()),
        Arc::new(mcp_server_repo.clone()),
        import_service.clone(),
        mcp_selector.clone(),
    ));

    tracing::info!("initialized onboarding service");

    let mcp_public_url = &config.mcp_public_url;
    let mcp_client_metadata = mcp_client::domain::models::OAuthClientMetadata::new(
        format!("{mcp_public_url}/mcp/servers/auth/client-metadata"),
        format!("{mcp_public_url}/mcp/servers/auth/callback"),
    );
    let mcp_oauth_state_store =
        mcp_client::outbound::redis_state_store::RedisOAuthStateStore::new(redis_client.clone());
    let mcp_pre_registered =
        mcp_client::domain::provider_registry::PreRegisteredProviders::from_env()?;
    let mcp_oauth = mcp_client::outbound::oauth::OAuthService::new(
        mcp_server_repo.clone(),
        mcp_oauth_state_store,
        mcp_client_metadata.clone(),
        mcp_pre_registered,
    );
    // The moment a connector finishes OAuth, reconcile onboarding for that
    // user — gather jobs start before the user even returns to their
    // original tab. Spawned so the callback response never waits on them.
    let onboarding_for_auth_hook = onboarding_service.clone();
    let mcp_auth_hook: mcp_client::inbound::axum_router::McpAuthCompletedHook =
        Arc::new(move |record: mcp_client::domain::models::McpServerRecord| {
            let service = onboarding_for_auth_hook.clone();
            Box::pin(async move {
                tokio::spawn(async move {
                    use onboarding::domain::service::OnboardingService;
                    if let Err(e) = service.reconcile(record.user_id).await {
                        tracing::warn!(error = ?e, "post-auth onboarding reconcile failed");
                    }
                });
            })
        });
    let mcp_state = mcp_client::inbound::McpRouterState::new(
        mcp_server_repo,
        mcp_oauth,
        authorization_state.clone(),
        mcp_client_metadata,
    )
    .with_auth_completed_hook(mcp_auth_hook);

    // The Pipedream stack gets the same post-connect reconcile hook as the
    // native one: a finished Connect flow starts gather jobs immediately.
    let onboarding_for_pipedream_hook = onboarding_service.clone();
    let pipedream_auth_hook: pipedream_mcp::inbound::axum_router::PipedreamAuthCompletedHook =
        Arc::new(
            move |connection: pipedream_mcp::domain::models::PipedreamConnection| {
                let service = onboarding_for_pipedream_hook.clone();
                Box::pin(async move {
                    tokio::spawn(async move {
                        use onboarding::domain::service::OnboardingService;
                        if let Err(e) = service.reconcile(connection.user_id).await {
                            tracing::warn!(error = ?e, "post-connect onboarding reconcile failed");
                        }
                    });
                })
            },
        );
    let pipedream_state = pipedream_mcp::inbound::PipedreamRouterState::new(
        pipedream_repo,
        pipedream_client,
        authorization_state.clone(),
    )
    .with_auth_completed_hook(pipedream_auth_hook);

    let user_permissions_service = Arc::new(
        roles_and_permissions::domain::service::UserRolesAndPermissionsServiceImpl::new(
            roles_and_permissions::outbound::pgpool::MacroDB::new(db.clone()),
            roles_and_permissions::outbound::pgpool::MacroDB::new(db.clone()),
        ),
    );

    let api_result = api::setup_and_serve(ApiContext {
        db: db.clone(),
        email_service_client_external,
        sqs_client: Arc::new(sqs_client),
        document_storage_client: Arc::new(document_storage_client),
        search_service_client,
        authorization_state,
        user_permissions_service,
        internal_api_key: config.internal_api_key.clone(),
        config: Arc::new(config),
        notification_ingress_service,
        connection_repo: connection_manager.persistence,
        connection_gateway_client,
        soup_service,
        email_service: email_service_for_tools,
        stream_repo,
        document_tool_context,
        memory_service,
        usage_service,
        ai_projections_service,
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
        pipedream_state,
        mcp_selector,
        import_service,
        onboarding_service,
        macro_event_broker: macro_event_broker.clone(),
    })
    .await
    .context("failed to setup and serve api");

    ai_projection_worker_task.abort();
    match ai_projection_worker_task.await {
        Err(error) if error.is_cancelled() => {
            tracing::info!("ai projection worker stopped");
        }
        Err(error) => {
            tracing::error!(error = ?error, "ai projection worker exited unexpectedly");
        }
        Ok(()) => {
            tracing::error!(
                error = "worker exited naturally",
                "ai projection worker exited unexpectedly"
            );
        }
    }

    tracing::info!("waiting for event broker publishes to drain");
    event_broker_tracker.close();
    match tokio::time::timeout(EVENT_BROKER_DRAIN_TIMEOUT, event_broker_tracker.wait()).await {
        Ok(()) => tracing::info!("event broker publishes drained"),
        Err(error) => tracing::warn!(
            error=?error,
            timeout_seconds = EVENT_BROKER_DRAIN_TIMEOUT.as_secs(),
            "timed out waiting for event broker publishes to drain"
        ),
    }

    api_result
}

const EVENT_BROKER_DRAIN_TIMEOUT: Duration = Duration::from_secs(10);
