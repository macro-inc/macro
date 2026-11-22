//! The service's composition root: reads config and wires every adapter and
//! domain service into the HTTP server.

use crate::cognition::{
    api::{self, context::ApiContext},
    config::{Config, Environment},
    service::{
        self,
        integration_analytics::{IntegrationAnalytics, IntegrationChange},
    },
};
use ai_tools::{NoOpCallRtcClient, NoOpConnectionService, NoOpNotificationIngress};
use anyhow::Context;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use call::domain::service::{CallRecordQueryServiceImpl, CallServiceImpl};
use call::inbound::toolset::CallToolContext;
use call::outbound::pg_call_repo::PgCallRepo;
use call::outbound::s3_recording_storage::S3RecordingStorage;
use channels::{
    domain::list_service::ChannelListServiceImpl, outbound::pg_channels_repo::PgChannelsRepo,
};
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
use entity_registry::OwnerGrantPolicy;
use entity_registry_db_utils::OwnedEntityRegistrar;
use foreign_entity::{
    domain::service::ForeignEntityServiceImpl,
    outbound::pg_foreign_entity_repo::PgForeignEntityRepo,
};
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::outbound::postgres::FrecencyPgStorage;
use github_pull_requests::{
    domain::service::GithubPullRequestServiceImpl,
    outbound::pg_github_pull_request_repo::PgGithubPullRequestRepo,
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, PgUserApiKeyAuthorizationRepo, PgUserApiKeyAuthorizer,
};
use macro_service_urls::{
    AppServiceUrl, AuthServiceUrl, CalendarServiceUrl, ConnectionGatewayUrl,
    DocumentStorageServiceUrl, EmailServiceUrl, LexicalServiceUrl, StaticFileServiceUrl,
    SyncServiceUrl,
};
use notification::domain::service::{
    NotificationReaderService, PlatformArnConfig, SqsNotificationIngress,
};
use notification::outbound::queue::SqsQueue;
use notification::outbound::repository::DbNotificationRepository;
use notification::outbound::websocket::ConnectionGatewayClient;
use readonly_pool::ReadOnlyPool;
use search_service_client::SearchServiceClient;

use std::sync::Arc;
use stream::outbound::redis_pg::RedisPostgresStreamRepo;
use sync_service_client::SyncServiceClient;
use tokio_util::task::TaskTracker;

/// The cognition routes and workers owned by the harness process.
pub struct CognitionRuntime {
    /// Routes mounted on the harness's public listener.
    pub router: axum::Router,
    workers: Vec<tokio_util::task::AbortOnDropHandle<()>>,
    cancellation: tokio_util::sync::CancellationToken,
}

impl CognitionRuntime {
    /// Stop intake before the shared HTTP listener and sessions drain.
    pub fn stop(&self) {
        self.cancellation.cancel();
        for worker in &self.workers {
            worker.abort();
        }
    }
    /// Stop workers before the harness drains pending event publishes.
    pub async fn shutdown(self) {
        self.stop();
        for worker in self.workers {
            worker.abort();
            let _ = worker.await;
        }
    }
}

/// Compose chat, completions, integrations, and workers in the harness process.
///
/// `import_jobs` are the harness's import jobs: this runtime's Notion imports
/// and the stalled-import sweeper run on them, and the harness hands them
/// over on shutdown. `composed` is the process's one connectors composition:
/// chat, imports, Granola's sync and onboarding read connections through it
/// and the `/connectors` routes serve it.
pub async fn build(
    config: Config,
    db: sqlx::PgPool,
    event_broker_tracker: TaskTracker,
    import_jobs: ai_tools::ImportJobs,
    composed: &connectors::composition::Composed,
) -> anyhow::Result<CognitionRuntime> {
    let public_url = macro_service_urls::CognitionPublicUrl::new()?;
    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );
    let config = config
        .resolve_remote_secrets(Environment::new_or_prod(), &secretsmanager_client)
        .await
        .context("failed to resolve cognition secrets")?;
    let non_user_owners = config.non_user_owners()?;
    let dynamodb_client = aws_sdk_dynamodb::Client::new(&aws_config);
    let queue_aws_client = aws_sdk_sqs::Client::new(&aws_config);

    let document_text_extractor_queue = macro_queues::DocumentTextExtractorQueue::new();
    let chat_delete_queue = macro_queues::ChatDeleteQueue::new();
    let email_scheduled_queue = macro_queues::EmailScheduledQueue::new();
    let gmail_ops_queue = macro_queues::GmailOpsQueue::new();
    let notification_queue = macro_queues::NotificationIngressQueue::new();
    let sqs_client = sqs_client::SQS::new(queue_aws_client)
        .document_text_extractor_queue(&document_text_extractor_queue)
        .chat_delete_queue(&chat_delete_queue)
        .email_scheduled_queue(&email_scheduled_queue)
        .gmail_ops_queue(&gmail_ops_queue);

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
            PgUserApiKeyAuthorizer::new(PgUserApiKeyAuthorizationRepo::new(db.clone())),
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
        EmailPgRepo::new(db.clone()).with_rule_discovery(Arc::new(
            crm::outbound::email_rule_discovery::PgEmailRuleDiscovery,
        )),
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
    let github_pull_request_service = GithubPullRequestServiceImpl::new(
        ForeignEntityServiceImpl::new(PgForeignEntityRepo::new(db.clone())),
        PgGithubPullRequestRepo::new(db.clone()),
    );
    let favorites_service = ai_tools::build_favorites_service(db.clone());
    let soup_service = Arc::new(
        soup::domain::service::SoupImpl::new(
            soup::outbound::pg_soup_repo::PgSoupRepo::new(ReadOnlyPool(db.clone())),
            frecency_service,
            ReadonlyEmailPreviewAdapter(email_service),
            channels_service,
            CallRecordQueryServiceImpl::new(PgCallRepo::new(db.clone())),
            crm::domain::service::NoOpCrmService,
            github_pull_request_service,
        )
        .with_favorites(favorites_service.clone()),
    );

    tracing::info!("initialized soup service");

    let s3_client = macro_aws_config::s3_client().await;
    let document_files = documents::outbound::s3_document_files::S3DocumentFiles::new(
        db.clone(),
        s3_client.clone(),
        config.document_storage_bucket.to_string(),
    );
    let s3_upload_adapter = S3UploadUrlAdapter::new(
        s3_client,
        config.document_storage_bucket.to_string(),
        config.docx_document_upload_bucket.to_string(),
    );
    let owned_entity_registrar =
        OwnedEntityRegistrar::new(OwnerGrantPolicy::new(PgBotsRepo::new(db.clone())));
    let document_repo = PgDocumentRepo::new(db.clone(), owned_entity_registrar.clone());

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
    let macro_event_broker = macro_event_broker::MacroEventBrokerService::new(
        macro_event_broker::KafkaEventPublisher::new(config.kafka_brokers.as_ref())
            .context("failed to create kafka event publisher")?,
        event_broker_tracker.clone(),
    );
    let properties_service = ai_tools::build_properties_service_with_broker(
        db.clone(),
        entity_access_service.clone(),
        macro_event_broker.clone(),
    );
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
    // Messages sent by AI tools (chat, agents) dispatch the same side effects
    // as the document-storage message API, so mentions, replies and document
    // comments notify recipients and stream to connected clients.
    let channels_connection_gateway =
        Arc::new(connection_gateway_client::ConnectionGatewayClient::new(
            internal_api_key.clone(),
            ConnectionGatewayUrl::new()?.to_string(),
        ));
    let side_effect_clients = ai_tools::ChannelSideEffectClients {
        connection_gateway: channels_connection_gateway.clone(),
        sqs: aws_sdk_sqs::Client::new(&aws_config),
        macro_event_broker: macro_event_broker.clone(),
        environment: config.environment,
        feature_flags: ai_tools::service_feature_flags(
            config.posthog_api_key.value(),
            config.posthog_host.value(),
            config.environment,
        )?,
    };
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
        ai_tools::build_message_service_with_side_effects(
            db.clone(),
            lexical_client.clone(),
            &side_effect_clients,
        ),
    )
    .with_presentation_files(Arc::new(document_files.clone()))
    .with_word_document_files(Arc::new(document_files.clone()))
    .with_design_files(Arc::new(document_files.clone()))
    .with_photoshop_files(Arc::new(document_files.clone()))
    .with_illustrator_files(Arc::new(document_files));

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
            Arc::new(chat::outbound::postgres::PgChatRepo::new(
                db.clone(),
                owned_entity_registrar.clone(),
            )),
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
            chat::outbound::postgres::PgChatRepo::new(db.clone(), owned_entity_registrar.clone()),
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

    // The AI billing gate below and the email tools' send-as lookup both
    // reach the authentication service.
    let auth_service_client = Arc::new(authentication_service_client::AuthServiceClient::new(
        config
            .authentication_service_secret_key
            .as_ref()
            .to_string(),
        AuthServiceUrl::new()?.to_string(),
    ));
    let user_email_service = Arc::new(
        EmailServiceImpl::new(
            EmailPgRepo::new(db.clone()).with_rule_discovery(Arc::new(
                crm::outbound::email_rule_discovery::PgEmailRuleDiscovery,
            )),
            FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(db.clone())),
            sqs_client.clone(),
            crm_service.clone(),
            entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
                entity_access_management::outbound::PgRepository::new(db.clone()),
            ),
            0,
        )
        // Lets `SendEmail`'s `from` name a verified send-as alias of an inbox.
        .with_sender_provider(email::outbound::GmailSenderProvider::new(
            gmail_client::GmailClient::without_watch(),
            email::outbound::GmailTokenProviderImpl::lazy(
                (*redis_client).clone(),
                auth_service_client.clone(),
            ),
        ))
        .with_macro_event_broker(macro_event_broker.clone()),
    );
    let email_tool_context = email::inbound::toolset::EmailToolContext::new(
        user_email_service.clone(),
        Arc::new(email::domain::ports::NoOpGmailTokenProvider),
        Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
            db.clone(),
        ))),
        lexical_client.clone(),
    )
    .with_attachment_sender(
        ai_tools::email_attachments::build_email_attachment_sender(
            user_email_service.clone(),
            EmailPgRepo::new(db.clone()),
            document_tool_context.service.clone(),
        )
        .await,
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
            chat::outbound::postgres::PgChatRepo::new(db.clone(), owned_entity_registrar.clone()),
            Arc::new(ai_toolset::AsyncToolCollection::new()),
            (),
            entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
                entity_access_management::outbound::PgRepository::new(db.clone()),
            ),
        ),
        (*entity_access_service).clone(),
    );

    tracing::info!("initialized chat tool context");

    let channel_tool_context = ai_tools::build_channel_tool_context_with_side_effects(
        db.clone(),
        lexical_client.clone(),
        &side_effect_clients,
    );
    let user_permissions_service = Arc::new(
        roles_and_permissions::domain::service::UserRolesAndPermissionsServiceImpl::new(
            roles_and_permissions::outbound::pgpool::MacroDB::new(db.clone()),
        ),
    );

    // The AI billing gate reads allowances, credits, and overage state here;
    // collection (Stripe) lives in the authentication service, which the
    // recorder below asks to settle once a payer runs past their allowance
    // and ENABLE_AI_USAGE_BILLING is enabled. This instance never settles.
    let ai_pricing = config.ai_pricing();
    let ai_billing = Arc::new(
        ai_billing::domain::BillingServiceImpl::new(
            ai_billing::outbound::RolesTeamsEntitlementSource::new(
                (*user_permissions_service).clone(),
                teams::outbound::team_repo::TeamRepositoryImpl::new(db.clone()),
            ),
            ai_billing::outbound::PgUsageReader::new(db.clone()),
            ai_billing::outbound::PgBillingRepo::new(db.clone(), ai_pricing),
            ai_billing::outbound::HttpPaymentGateway::new(auth_service_client.clone()),
            ai_pricing,
        )
        .with_enforcement(config.enable_ai_usage_enforcement),
    );
    let admission: Arc<dyn ai_billing::AiAdmissionService> =
        Arc::new(ai_billing::BillingAdmissionService::new(
            ai_billing.clone(),
            config.enable_ai_usage_enforcement,
        ));
    let recorder: Arc<dyn ai_usage::UsageRecorder> =
        Arc::new(ai_billing::outbound::SettlingUsageRecorder::new(
            Arc::new(
                ai_usage::domain::service::UsageServiceImpl::new(
                    ai_usage::outbound::PgUsageRepo::new(db.clone()),
                )
                .with_enforcement(config.enable_ai_usage_enforcement),
            ),
            ai_billing.clone(),
            ai_billing::outbound::HttpSettlementTrigger::new(auth_service_client.clone()),
            config.enable_ai_usage_billing,
        ));

    // Per-attempt observations use a separate journal and never feed the
    // legacy settlement trigger, which remains counted-usage-only and gated by
    // ENABLE_AI_USAGE_BILLING.
    let recorder = ai_usage::with_tracking(recorder, ai_usage::pg_tracking(db.clone()));

    let decision_classifier = config
        .typesafe_api_key
        .value()
        .map(jev::outbound::SystemOneJev::typesafe)
        .transpose()
        .context("failed to configure the decision classifier")?
        .map(|provider| jev::domain::JevClassifier::new(provider, recorder.clone()));
    let decisions = Arc::new(jev::domain::decisions::DecisionServiceImpl::new(
        decision_classifier,
        admission.clone(),
    ));
    let tool_free_completions = Arc::new(
        crate::cognition::service::structured_completion::ToolFreeCompletionService::new(
            recorder.clone(),
        ),
    );

    // The import pipeline: staged/imported external items, Slack discovery,
    // and the Notion page import job. Built before the tool service context
    // so the chat toolset gets a wired import context. Granola's webhook
    // secrets are sealed with a key derived from the MCP credentials key.
    let mcp_encryption_key =
        connectors::composition::AesKey::try_from(config.mcp_credentials_key_secret_name.as_ref())
            .context("invalid MCP credentials encryption key")?;
    let granola_signing_key = *mcp_encryption_key.as_bytes();
    let connections = Arc::new(composed.connectors.clone());

    let granola_sync: Option<Arc<dyn granola_sync::domain::service::SyncService>> =
        Some(Arc::new(granola_sync::domain::service::Service {
            repo: granola_sync::outbound::pg_repo::PgSyncRepository::new(
                db.clone(),
                &granola_signing_key,
            ),
            granola: granola_sync::outbound::api::GranolaApi(Arc::clone(&connections)),
            accounts: granola_sync::outbound::accounts::ConnectedAccounts(Arc::clone(&connections)),
            verifier: granola_sync::outbound::signature::StandardWebhooks,
            calls: Arc::new(call::domain::imports::CallImportServiceImpl(
                call::outbound::pg_imported_call_repo::PgImportedCallRepository::new(db.clone()),
                macro_event_broker.clone(),
            )),
            public_url: public_url.to_string(),
        })
            as Arc<dyn granola_sync::domain::service::SyncService>);
    let granola_worker = granola_sync
        .as_ref()
        .map(|service| tokio::spawn(granola_sync::inbound::run_worker(service.clone())));

    // Nudges the user's connected clients when import rows flip, so setup
    // sections and chat surfaces update immediately instead of on the next
    // poll (see import::outbound::gateway_notifier).
    let import_notify = import::outbound::gateway_notifier::gateway_import_notify(
        channels_connection_gateway.clone(),
    );

    let initiative_tool_context = ai_tools::build_initiative_tool_context(
        db.clone(),
        &document_tool_context,
        properties_service.clone(),
        entity_access_service.clone(),
        macro_event_broker.clone(),
    );

    let databases_tool_context = ai_tools::build_databases_tool_context(
        db.clone(),
        entity_access_service.clone(),
        ai_tools::ToolTableEventPublisher::Gateway(
            databases::outbound::gateway_event_publisher::GatewayTableEventPublisher::new(
                channels_connection_gateway.as_ref().clone(),
            ),
        ),
        ai_tools::MaybeToolEventBroker::Real(macro_event_broker.clone()),
    );
    let project_tool_context = ai_tools::build_project_tool_context(
        db.clone(),
        macro_event_broker.clone(),
        entity_access_service.clone(),
        document_tool_context.service.clone(),
        user_email_service.clone(),
        databases_tool_context.service.clone(),
    );

    let entity_creator = ai_tools::ToolEntityCreator {
        document_creator: document_tool_context.creator.clone(),
        entity_access_service: entity_access_service.clone(),
        channel_service: channel_tool_context.service.clone(),
        task_properties: task_properties_for_import,
        document_properties: document_properties_for_import,
        team_repository: ai_tools::build_team_repository(db.clone()),
        initiative_service: initiative_tool_context.service.clone(),
        project_service: project_tool_context.service.clone(),
        databases_service: databases_tool_context.service.clone(),
        document_service: document_tool_context.service.clone(),
    };
    let import_service = Arc::new(
        import::domain::service::ImportServiceImpl::new(
            ai_tools::build_import_repo(db.clone()),
            Arc::clone(&connections),
            Arc::new(entity_creator),
            recorder.clone(),
        )
        .with_slack_source(Arc::new(
            import::outbound::mcp_slack_source::McpSlackSource::new(Arc::clone(&connections)),
        ))
        .with_tracker_connections(
            Arc::new(import_linear::outbound::client::LinearConnections::new(
                Arc::clone(&connections),
            )),
            Arc::new(import_jira::outbound::client::JiraConnections::new(
                Arc::clone(&connections),
            )),
        )
        .with_notion_connections(Arc::new(
            import_notion::outbound::connected::ConnectedNotion::new(Arc::clone(&connections)),
        ))
        .with_admission(admission.clone())
        .with_notifier(import_notify)
        .with_job_shutdown(import_jobs.shutdown.clone(), import_jobs.tracker.clone()),
    );

    // Notion workspace imports outlive the process running them: on shutdown
    // a running job hands its run over, and the sweeper adopts runs whose
    // process stopped holding them (other replicas' live runs are leased, so
    // it leaves them alone). Slack and single-page jobs heal on read. This is
    // the process's only sweeper.
    import_jobs.tracker.spawn({
        let import_service = import_service.clone();
        let shutdown = import_jobs.shutdown.clone();
        async move { import_service.sweep_stalled_notion_imports(shutdown).await }
    });
    tracing::info!("initialized import service");

    let databases_sql_tool_context = ai_tools::build_databases_sql_tool_context(
        &databases_tool_context,
        soup_service.clone(),
        db.clone(),
        side_effect_clients.feature_flags.clone(),
    );
    let crm_tool_context = ai_tools::build_crm_tool_context(db.clone());
    let pipeline_tool_context = ai_tools::build_pipeline_tool_context(
        db.clone(),
        &databases_tool_context,
        &crm_tool_context,
    );
    let crm_transfer_tool_context = ai_tools::build_crm_transfer_tool_context(
        &pipeline_tool_context,
        &crm_tool_context,
        &document_tool_context,
    );

    let calendar_tool_context = ai_tools::build_calendar_tool_context(
        db.clone(),
        CalendarServiceUrl::new()?,
        internal_api_key.clone(),
        call_tool_context.service.clone(),
        AppServiceUrl::new()?,
        macro_env_var::maybe_read_env("ENABLE_CALENDAR_ADD_SHARED_EVENT")
            .and_then(|value| value.parse::<bool>().ok())
            .unwrap_or(false),
    );
    let forms_tool_context = ai_tools::build_forms_tool_context(
        db.clone(),
        &document_tool_context,
        &databases_tool_context,
        &calendar_tool_context,
        Some(channels_connection_gateway.as_ref().clone()),
        ai_tools::MaybeToolEventBroker::Real(macro_event_broker.clone()),
        ai_tools::FormsToolConfig {
            app_origin: macro_service_urls::AppServiceUrl::new()?.to_string(),
            editing_worker_url: config.ai_editing_worker_url.clone(),
            static_files: static_file_service_client::StaticFileServiceClient::new(
                internal_api_key.clone(),
                macro_service_urls::StaticFileServiceUrl::new()?.to_string(),
            ),
        },
    );

    let tool_service_context = ai_tools::ToolServiceContext {
        memory_tool_context: ai_tools::memory::build_memory_tool_context(
            db.clone(),
            recorder.clone(),
        ),
        cognition_tool_context: ai_tools::build_cognition_tool_context()?,
        connector_tool_context: ai_tools::build_connector_tool_context(Some(composed)),
        search_service_client: search_service_client.clone(),
        email_service_client: email_service_client_external.clone(),
        soup_service: soup_service.clone(),
        email_service: email_service_for_tools.clone(),
        activity_service: ai_tools::build_activity_read_service(
            db.clone(),
            properties_service,
            entity_access_service.clone(),
        ),
        image_generation_tool_context: ai_tools::build_image_generation_tool_context(
            &document_tool_context,
            ai_tools::build_image_generator_from_env(),
            recorder.clone(),
        )?,
        message_tool_context: ai_tools::build_message_tool_context(&document_tool_context),
        document_tool_context: document_tool_context.clone(),
        properties_tool_context: properties_tool_context.clone(),
        email_tool_context: email_tool_context.clone(),
        call_tool_context: call_tool_context.clone(),
        booking_management_tool_context: ai_tools::build_booking_management_tool_context(
            CalendarServiceUrl::new()?,
            internal_api_key.clone(),
            config.environment,
        ),
        booking_link_tool_context: ai_tools::build_booking_link_tool_context(
            db.clone(),
            config.environment,
        ),
        calendar_tool_context,
        team_calendar_tool_context: ai_tools::build_team_calendar_tool_context(
            db.clone(),
            macro_env_var::maybe_read_env("CALENDAR_TEAM_SHARING_ENABLED")
                .and_then(|value| value.parse::<bool>().ok())
                .unwrap_or(false),
        ),
        notification_tool_context: notification_tool_context.clone(),
        item_notification_preference_tool_context:
            ai_tools::build_item_notification_preference_tool_context(db.clone()),
        databases_tool_context,
        forms_tool_context,
        databases_sql_tool_context,
        import_tool_context: import::inbound::toolset::ImportToolContext::wired(
            import_service.clone(),
        ),
        chat_tool_context,
        channel_tool_context,
        channel_media_upload_tool_context: ai_tools::build_channel_media_upload_tool_context()?,
        bot_tool_context: ai_tools::build_bot_tool_context(
            db.clone(),
            ai_tools::MaybeToolEventBroker::Real(macro_event_broker.clone()),
            entity_access_service.clone(),
            DocumentStorageServiceUrl::new()?.to_string(),
            Some(composed.connectors.clone()),
        ),
        read_agent_session_context: ai_tools::build_read_agent_session_context(
            db.clone(),
            entity_access_service.clone(),
        ),
        coding_agent_tool_context: ai_tools::build_coding_agent_tool_context(
            macro_service_urls::AgentHarnessServiceUrl::new()?,
            internal_api_key.clone(),
        )?,
        project_tool_context,
        favorites_tool_context: ai_tools::build_favorites_tool_context(
            favorites_service,
            entity_access_service.clone(),
        ),
        initiative_tool_context,
        team_tool_context: ai_tools::build_team_tool_context(db.clone()),
        crm_tool_context,
        pipeline_tool_context,
        crm_transfer_tool_context,
        skill_tool_context: ai_tools::build_skill_tool_context(
            search_service_client.clone(),
            soup_service.clone(),
            &document_tool_context,
        ),
        schedule_tool_context: ai_tools::build_routine_tool_context()?,
        anthropic_tool_context: ai_tools::build_anthropic_tool_context(),
        web_search_provider: ai_tools::build_web_search_provider_from_env(),
        admission,
        recorder,
        usage_context: ai_usage::UsageContext::system(ai_usage::AiFeature::Chat),
    };
    let all_tools = ai_tools::tools_for(ai_tools::AiHost::Chat);
    let all_tools_toolset = all_tools.toolset.clone();
    let all_tools_prompt: Arc<dyn std::fmt::Display + Send + Sync> =
        Arc::new(all_tools.prompt.to_string());

    // Build memory service
    let memory_service = Arc::new(ai_tools::memory::build_memory_service(
        db.clone(),
        tool_service_context.clone(),
    ));

    tracing::info!("initialized memory service");

    // Build the AI cost service. It backs both the admin query/pricing router
    // and the usage recorder threaded through the tool service context.
    let usage_service = Arc::new(
        ai_usage::domain::service::UsageServiceImpl::new(ai_usage::outbound::PgUsageRepo::new(
            db.clone(),
        ))
        .with_enforcement(config.enable_ai_usage_enforcement),
    );

    tracing::info!("initialized ai cost service");

    let onboarding_service = Arc::new(onboarding::domain::service::OnboardingServiceImpl::new(
        onboarding::outbound::pg_onboarding_repo::PgOnboardingRepo::new(db.clone()),
        Arc::clone(&connections),
    ));

    tracing::info!("initialized onboarding service");

    // The `/connectors` routes and the public callbacks over the process's
    // connectors, recording connects and disconnects for product analytics.
    let integration_analytics = IntegrationAnalytics::from_config(&config, &db);
    let connectors_state = connectors::inbound::axum_router::ConnectorsRouterState::new(
        composed.connectors.clone(),
        composed.catalog.clone(),
        authorization_state.clone(),
    )
    .with_importable(importable_apps()?)
    .with_connected_hook(integration_analytics.hook(IntegrationChange::Connected))
    .with_removed_hook(integration_analytics.hook(IntegrationChange::Disconnected));
    let callbacks_state =
        connectors::inbound::callbacks::CallbacksState::new(composed.sign_ins.clone())
            .with_connected_hook(integration_analytics.hook(IntegrationChange::Connected));

    let cancellation = tokio_util::sync::CancellationToken::new();
    if !matches!(config.environment, Environment::Local) {
        // Without a PostHog key there is no kill switch, and refresh runs.
        let memory_flags = config
            .posthog_api_key
            .value()
            .map(|key| {
                feature_flags::outbound::posthog::PostHogFeatureFlags::new(
                    config
                        .posthog_host
                        .value()
                        .unwrap_or(crate::DEFAULT_POSTHOG_HOST),
                    key.to_owned(),
                    std::time::Duration::from_secs(3),
                    config.environment,
                )
                .map_err(|error| anyhow::anyhow!("invalid feature flag configuration: {error}"))
            })
            .transpose()?;
        memory::schedule::start(
            memory_service.clone(),
            memory_flags,
            &event_broker_tracker,
            cancellation.clone(),
        )?;
    }
    let router = api::build_router(ApiContext {
        db: db.clone(),
        email_service_client_external,
        sqs_client: Arc::new(sqs_client),
        document_storage_client: Arc::new(document_storage_client),
        search_service_client,
        authorization_state,
        user_permissions_service,
        non_user_owners,
        ai_admission: tool_service_context.admission.clone(),
        decisions,
        tool_free_completions,
        ai_billing,
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
        web_rate_limiter: rate_limit::RateLimitServiceImpl {
            repo: rate_limit::RedisRateLimitAdapter {
                redis: (*redis_client).clone(),
            },
        },
        connectors_state,
        callbacks_state,
        connectors: composed.connectors.clone(),
        granola_sync,
        import_service,
        onboarding_service,
        macro_event_broker: macro_event_broker.clone(),
    });
    let workers = granola_worker
        .into_iter()
        .map(tokio_util::task::AbortOnDropHandle::new)
        .collect();
    Ok(CognitionRuntime {
        router,
        workers,
        cancellation,
    })
}

/// The apps Macro imports from, and what each import reads: Linear, Jira and
/// Notion through the app's REST API, Slack's channels through its MCP tools.
fn importable_apps() -> anyhow::Result<connectors::inbound::dto::Importable> {
    use connectors::domain::models::ConnectorId;
    use connectors::inbound::dto::{ImportSurface, Importable};

    let mut importable = Importable::new();
    for (slug, surface) in [
        ("linear", ImportSurface::Api),
        ("jira", ImportSurface::Api),
        ("notion", ImportSurface::Api),
        ("slack", ImportSurface::Mcp),
    ] {
        importable = importable.with(
            ConnectorId::parse(slug).context("an import's app slug is not an app slug")?,
            surface,
        );
    }
    Ok(importable)
}
