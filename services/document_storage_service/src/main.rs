#![recursion_limit = "256"]
use crate::{
    api::{
        MACRO_INTERNAL_USER_ID,
        context::{
            ApiContext, AuthorizationService, DocumentStorageServiceAuthKey, TaskPropertiesAdapter,
        },
    },
    config::{
        CalEventTypeContentNamesKey, CalWebhookSecretKey, MetaAccessToken, MetaPixelId,
        MetaTestEventCode,
    },
    service::s3::S3,
};
use analytics_client::{AnalyticsClient, AnalyticsClientConfig, MetaConfig};
use anyhow::Context;
use bots::{domain::service::BotServiceImpl, outbound::pg_bots_repo::PgBotsRepo};
use cal::{
    domain::service::{CalConfig, CalEventMeta, CalWebhookServiceImpl},
    inbound::cal_webhook_router::CalWebhookRouterState,
    outbound::analytics_client::AnalyticsClientSink,
};
use calendar_events::domain::reminder_dispatch::CalendarReminderDispatchService;
use calendar_events::inbound::axum_router::CalendarRouterState;
use calendar_events::inbound::dispatch_worker::CalendarReminderDispatchWorker;
use calendar_events::outbound::notification_notifier::NotificationCalendarReminderNotifier;
use calendar_events::outbound::sqs_dispatch_queue::SqsCalendarDispatchQueue;
use call::{
    domain::service::CallServiceImpl,
    inbound::axum_router::{CallRouterState, InternalCallRouterState, WebhookRouterState},
    outbound::{
        ai_call_summarizer::AiCallSummarizer,
        livekit_rtc_client::LivekitRtcClient,
        pg_call_repo::PgCallRepo,
        pg_voice_repo::PgVoiceRepo,
        s3_recording_storage::{RecordingCloudFrontConfig, S3RecordingStorage},
    },
};
use channels::{
    domain::{
        list_service::ChannelListServiceImpl,
        service::ChannelServiceImpl,
        side_effects::{ChannelSideEffectService, SpawnedChannelEventDispatcher},
    },
    inbound::{axum_router::ChannelsRouterState, list_router::ChannelListRouterState},
    outbound::{
        connection_gateway_realtime::ConnectionGatewayChannelRealtimePublisher,
        contacts_dispatcher::ContactsChannelDispatcher,
        notification_sender::NotificationChannelSender,
        pg_channel_reference_share_permissions::PgChannelReferenceSharePermissions,
        pg_channels_repo::PgChannelsRepo, pg_side_effect_context::PgChannelSideEffectContext,
    },
};
use collab_surface::{
    domain::service::CollabSurfaceServiceImpl, inbound::axum_router::CollabSurfaceRouterState,
    outbound::pg_collab_surface_repo::PgCollabSurfaceRepo,
    outbound::surface_init::LexicalSyncSurfaceInitializer,
};
use config::{Config, Environment};
use connection::{
    domain::service::ConnectionServiceImpl,
    outbound::connection_gateway_client::ConnectionGatewayImpl,
};
use connection_gateway_client::client::ConnectionGatewayClient;
use documents_hex::domain::models::CloudFrontConfig;
use documents_hex::domain::service::DocumentServiceImpl;
use documents_hex::inbound::axum_router::DocumentRouterState;
use documents_hex::outbound::pg_document_repo::PgDocumentRepo;
use documents_hex::outbound::s3_upload_url::S3UploadUrlAdapter;
use dynamodb_client::DynamodbClient;
use email::{
    domain::{ports::ReadonlyEmailPreviewAdapter, service::EmailServiceImpl},
    outbound::EmailPgRepo,
};
use embedding::embedding_provider::openai::TextEmbedding3Small;
use favorites::{
    domain::service::FavoritesServiceImpl, inbound::axum_router::FavoritesRouterState,
    outbound::pg_favorites_repo::PgFavoritesRepo,
};
use foreign_entity::{
    domain::service::ForeignEntityServiceImpl, inbound::axum_router::ForeignEntityRouterState,
    outbound::pg_foreign_entity_repo::PgForeignEntityRepo,
};
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use github::domain::service::{GithubSyncConfig, GithubSyncServiceImpl};
use github::outbound::github_sync_client::GithubSyncClientImpl;
use github::outbound::pg_github_sync_repo::PgGithubSyncRepo;
use harnesses::outbound::pg_harness_repo::PgHarnessRepo;
use lexical_client::LexicalClient;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, PgBotAuthorizationRepo, PgBotAuthorizer, PgHarnessAuthorizationRepo,
    PgHarnessAuthorizer, PgUserApiKeyAuthorizationRepo, PgUserApiKeyAuthorizer,
};
use macro_entrypoint::MacroEntrypoint;
use macro_env_var::maybe_env_vars;
use macro_event_broker::{KafkaEventPublisher, MacroEventBrokerService};
#[cfg(feature = "delete_document_worker")]
use macro_service_urls::AiEditingWorkerUrl;
use macro_service_urls::{ConnectionGatewayUrl, LexicalServiceUrl, SyncServiceUrl};
use macro_sha_count_client::Redis;
use notification::domain::service::{
    NotificationReaderService, PlatformArnConfig, SqsNotificationIngress,
    WebSocketNotificationConsumerService,
};
use notification::outbound::{notification_consumer::NotificationTopicConsumer, queue::SqsQueue};
use opensearch_client::OpensearchClient;
use projects_hex::{
    domain::service::ProjectServiceImpl,
    inbound::axum_router::ProjectRouterState,
    outbound::{
        DynamoBulkUploadAdapter, PgProjectRepo, S3ProjectUploadAdapter, ShaCountAdapter,
        SqsProjectSearchIndexer,
    },
};
use properties::{
    NotificationServiceImpl, PermissionServiceImpl, PropertiesPgRepo, PropertiesServiceImpl,
};
use rate_limit::{RateLimitServiceImpl, RedisRateLimitAdapter};
use reminders::{
    domain::service::{RemindersServiceImpl, dispatch::ReminderDispatchService},
    inbound::{axum_router::RemindersRouterState, dispatch_worker::DispatchWorker},
    outbound::{
        notification_notifier::NotificationReminderNotifier, pg_reminders_repo::PgRemindersRepo,
        sqs_dispatch_queue::SqsDispatchQueue,
    },
};
use secretsmanager_client::SecretManager;
use soup::{
    domain::service::SoupImpl, inbound::axum_router::SoupRouterState,
    outbound::pg_soup_repo::PgSoupRepo,
};
use soup_realtime::{
    domain::service::{SoupRealtimeConsumerService, SoupRealtimeServiceImpl},
    outbound::{
        entity_access::EntityAccessExpander, kafka_publisher::KafkaSoupRealtimePublisher,
        soup_consumer::SoupTopicConsumer,
    },
};
use sqlx::postgres::PgPoolOptions;
use std::{sync::Arc, time::Duration};
use sync_service_client::SyncServiceClient;
use system_properties::{PgSystemPropertiesRepository, SystemPropertiesServiceImpl};
use task_dedup::{
    TaskDedupService,
    outbound::{
        cohere::CohereReranker,
        connection_gateway::ConnectionGatewayTaskDedupNotifier,
        judge::AgentDuplicateJudge,
        postgres::{PgTaskMatchRepo, PgTaskVectorDb},
    },
};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use user_api_key::{
    domain::service::UserApiKeyServiceImpl, inbound::axum_router::UserApiKeyRouterState,
    outbound::pg_user_api_keys_repo::PgUserApiKeysRepo,
};

mod api;
mod config;
mod model;
mod outbound;
mod service;

const SOUP_CONSUMER_RESTART_MAX_DELAY_SECS: u64 = 60;
const SOUP_CONSUMER_RESTART_ALERT_THRESHOLD: u32 = 5;

fn soup_consumer_restart_delay(consecutive_failures: u32) -> Duration {
    let exponent = consecutive_failures.saturating_sub(1).min(6);
    Duration::from_secs((1_u64 << exponent).min(SOUP_CONSUMER_RESTART_MAX_DELAY_SECS))
}

maybe_env_vars! {
    struct AppleBundleId;
    struct SnsApnsVoipPlatformArn;
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = run().await;
    entrypoint.shutdown();
    result
}

async fn run() -> anyhow::Result<()> {
    let env = Environment::new_or_prod();

    let aws_config = macro_aws_config::get_macro_aws_config().await;

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    // Parse our configuration from the environment, then resolve any secret-manager backed values.
    let config = Config::from_env()
        .context("expected to be able to generate config")?
        .resolve_remote_secrets(env, &secretsmanager_client)
        .await
        .context("expected to be able to resolve config secrets")?;

    tracing::trace!("initialized config");

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (50, 150),
        Environment::Develop => (25, 100),
        Environment::Local => (15, 50),
    };

    let db = PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(&config.database_url)
        .await
        .context("could not connect to db")?;

    tracing::trace!(
        min_connections,
        max_connections,
        "initialized db connection"
    );

    let readonly_db = match PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(&config.database_url_readonly)
        .await
    {
        Ok(pool) => {
            tracing::trace!("initialized readonly db connection");
            pool
        }
        Err(e) => {
            tracing::warn!(error=?e, "failed to connect to readonly db, falling back to primary");
            db.clone()
        }
    };

    let dynamo_db = aws_sdk_dynamodb::Client::new(&aws_config);

    let dynamodb_client = DynamodbClient::new_from_client(
        dynamo_db.clone(),
        Some(config.bulk_upload_requests_table.as_ref().to_string()),
    );
    tracing::trace!("initialized dynamodb client");

    let s3_client = macro_aws_config::s3_client().await;

    tracing::trace!("initialized s3 client");

    let search_event_queue = macro_queues::SearchEventQueue::new();
    let document_delete_queue = macro_queues::DocumentDeleteQueue::new();
    let contacts_queue = macro_queues::ContactsQueue::new();
    let notification_queue = macro_queues::NotificationIngressQueue::new();
    let gmail_ops_queue = macro_queues::GmailOpsQueue::new();
    let reminder_dispatch_queue = macro_queues::ReminderDispatchQueue::new();
    let calendar_reminder_dispatch_queue = macro_queues::CalendarReminderDispatchQueue::new();
    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&aws_config))
        .search_event_queue(&search_event_queue)
        .document_delete_queue(&document_delete_queue)
        .gmail_ops_queue(&gmail_ops_queue);
    let webhook_event_queue = webhook::outbound::SqsWebhookQueue::new(
        Arc::new(sqs_client.clone()),
        macro_queues::WebhookEventQueue::new().to_string(),
        config.webhook_queue_max_messages,
        config.webhook_queue_wait_time_seconds,
    );

    let contacts_ingress = Arc::new(contacts::domain::service::SqsContactsIngress {
        queue: contacts::outbound::ingress::SqsContactsQueue::new(
            aws_sdk_sqs::Client::new(&aws_config),
            contacts_queue.to_string(),
        ),
    });

    tracing::trace!("initialized sqs client");

    // Redis handles it own connection pool internally. Each time we use redis
    // we should be using redis_client.get_connection() to grab a specific connection
    let redis_client = redis::Client::open(config.redis_uri.to_string().as_ref())
        .expect("could not connect to redis client");

    match redis_client.get_connection().is_err() {
        true => {
            tracing::error!("unable to connect to redis");
        }
        false => {
            tracing::trace!("initialized redis connection");
        }
    }

    let dss_auth_key = DocumentStorageServiceAuthKey::new()?;

    let conn_gateway_client = ConnectionGatewayClient::new(
        config.internal_api_key.to_string(),
        ConnectionGatewayUrl::new()?.to_string(),
    );

    let sync_service_client = Arc::new(SyncServiceClient::new(
        config.sync_service_auth_key.as_ref().to_string(),
        SyncServiceUrl::new()?.to_string(),
    ));

    let lexical_client = Arc::new(LexicalClient::new(
        config.internal_api_key.to_string(),
        LexicalServiceUrl::new()?.to_string(),
    ));

    let jwt_validation_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    let consumer_cancellation_token = CancellationToken::new();
    let consumer_tracker = TaskTracker::new();
    let event_broker_tracker = TaskTracker::new();
    let macro_event_broker = MacroEventBrokerService::new(
        KafkaEventPublisher::new(config.kafka_brokers.as_ref())
            .context("failed to create kafka event publisher")?,
        event_broker_tracker.clone(),
    );
    let bots_repo = PgBotsRepo::new(db.clone());
    let bots_service = BotServiceImpl::new(bots_repo, macro_event_broker.clone());

    let authorization_service: AuthorizationService = MacroAuthorizationServiceImpl::new(
        MacroAuthJwtValidator::new(jwt_validation_args.clone()),
        InternalAuthConfig {
            api_key: dss_auth_key.as_ref().to_string(),
            default_user_id: Some(MACRO_INTERNAL_USER_ID.to_string()),
        },
        PgBotAuthorizer::new(PgBotAuthorizationRepo::new(db.clone())),
        PgUserApiKeyAuthorizer::new(PgUserApiKeyAuthorizationRepo::new(db.clone())),
    )
    .with_harness_authorizer(PgHarnessAuthorizer::new(PgHarnessAuthorizationRepo::new(
        db.clone(),
    )));
    let authorization_state = MacroAuthorizationState::new(Arc::new(authorization_service));
    let harnesses_service =
        harnesses::domain::service::HarnessServiceImpl::new(PgHarnessRepo::new(db.clone()));

    // Initialize OpenSearch client
    let opensearch_client = OpensearchClient::new(
        config.opensearch_url.to_string(),
        config.opensearch_username.to_string(),
        config.opensearch_password.to_string(),
    )
    .context("unable to create opensearch client")?;

    if let Err(e) = opensearch_client.health().await {
        tracing::error!(error=?e, "error connecting to opensearch");
        return Err(e);
    }
    tracing::trace!("initialized opensearch client");

    let frecency_storage = FrecencyPgStorage::new(db.clone());
    let frecency_service = FrecencyQueryServiceImpl::new(frecency_storage.clone());
    // DSS only reads CRM rows — no-op resolver keeps reqwest/scraper
    // out of this binary.
    let crm_service = crm::domain::service::CrmServiceImpl::new(
        crm::outbound::companies_repo::CompaniesRepositoryImpl::new(db.clone()),
        crm::outbound::no_op_resolver::NoOpCompanyMetadataResolver,
    );
    let email_service = EmailServiceImpl::new(
        EmailPgRepo::new(db.clone()),
        frecency_service.clone(),
        sqs_client.clone(),
        crm_service.clone(),
        entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
            entity_access_management::outbound::PgRepository::new(db.clone()),
        ),
        0,
    )
    .with_macro_event_broker(macro_event_broker.clone());
    let readonly_email_service = ReadonlyEmailPreviewAdapter(
        EmailServiceImpl::new(
            EmailPgRepo::new(readonly_db.clone()),
            frecency_service.clone(),
            sqs_client.clone(),
            crm_service.clone(),
            entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
                entity_access_management::outbound::PgRepository::new(readonly_db.clone()),
            ),
            0,
        )
        .with_macro_event_broker(macro_event_broker.clone()),
    );
    let system_properties_service =
        SystemPropertiesServiceImpl::new(PgSystemPropertiesRepository::new(db.clone()));
    let ingress_queue = SqsQueue::new(
        aws_sdk_sqs::Client::new(&aws_config),
        notification_queue.to_string(),
    );
    let notification_ingress_service = Arc::new(SqsNotificationIngress {
        queue: ingress_queue.clone(),
    });
    let graphql_notification_reader: Arc<ai_tools::ToolNotificationService> =
        Arc::new(NotificationReaderService {
            repository: notification::outbound::repository::DbNotificationRepository::new(
                db.clone(),
            ),
            queue: ai_tools::ToolNotificationQueue::Sqs(ingress_queue.clone()),
            sns_endpoint: ai_tools::NoOpSnsEndpointManager,
            platform_config: PlatformArnConfig {
                apns_platform_arn: String::new(),
                fcm_platform_arn: String::new(),
                apns_voip_platform_arn: String::new(),
            },
            realtime: notification::domain::ports::NoopNotificationRealtimePublisher,
        });
    tracing::trace!("initialized notification ingress service");

    let entity_access_service = Arc::new(
        entity_access::domain::service::EntityAccessServiceImpl::new(
            entity_access::outbound::PgAccessRepository::new(db.clone()),
        ),
    );

    let permission_checker = PermissionServiceImpl::new(db.clone(), entity_access_service.clone());
    let notification_service = NotificationServiceImpl::new(
        SqsNotificationIngress {
            queue: ingress_queue,
        },
        db.clone(),
    );
    let properties_service = Arc::new(
        PropertiesServiceImpl::new(
            PropertiesPgRepo::new(db.clone()),
            Some(permission_checker),
            Some(notification_service),
        )
        .with_event_broker(macro_event_broker.clone()),
    );

    // Create the channel list service used by soup.
    let channel_service_for_soup = ChannelListServiceImpl::new(
        PgChannelsRepo::new(readonly_db.clone()),
        PgChannelsRepo::new(readonly_db.clone()),
        frecency_storage.clone(),
    );
    // Create the legacy channel list router state for routes mounted under /comms.
    let channel_list_state = ChannelListRouterState::new(
        ChannelListServiceImpl::new(
            PgChannelsRepo::new(db.clone()),
            PgChannelsRepo::new(db.clone()),
            frecency_storage.clone(),
        ),
        authorization_state.clone(),
    );

    let s3 = Arc::new(S3::new(
        s3_client,
        config.document_storage_bucket.as_ref(),
        config.docx_document_upload_bucket.as_ref(),
        config.upload_staging_bucket.as_ref(),
    ));
    let system_properties_service = Arc::new(system_properties_service);

    let document_repo = PgDocumentRepo::new(db.clone());
    let cloudfront_config = CloudFrontConfig {
        distribution_url: config
            .document_storage_service_cloudfront_distribution_url
            .as_ref()
            .to_string(),
        signer_public_key_id: config
            .document_storage_service_cloudfront_signer_public_key_id
            .as_ref()
            .to_string(),
        signer_private_key: config
            .document_storage_service_cloudfront_signer_private_key
            .as_ref()
            .to_string(),
        presigned_url_expiry_seconds: config.document_storage_service_presigned_url_expiry_seconds,
        browser_cache_expiry_seconds: config
            .document_storage_service_presigned_url_browser_cache_expiry_seconds,
    };
    let s3_upload_adapter = S3UploadUrlAdapter::new(
        macro_aws_config::s3_client().await,
        config.document_storage_bucket.as_ref(),
        config.docx_document_upload_bucket.as_ref(),
    );
    let markdown_initializer =
        documents_hex::outbound::markdown_init::LexicalSyncMarkdownInitializer::new(
            lexical_client.as_ref().clone(),
            sync_service_client.as_ref().clone(),
        );

    let connection_gateway = Arc::new(ConnectionGatewayImpl::new(conn_gateway_client.clone()));

    let connection_service =
        ConnectionServiceImpl::new(entity_access_service.clone(), connection_gateway.clone());

    let entity_access_management_service =
        entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
            entity_access_management::outbound::PgRepository::new(db.clone()),
        );

    let chat_mutation_service =
        Arc::new(chat::domain::service::ChatServiceImpl::new_without_tools(
            chat::outbound::postgres::PgChatRepo::new(db.clone()),
            entity_access_management_service.clone(),
        ));

    let project_service = Arc::new(ProjectServiceImpl::new(
        PgProjectRepo::new(db.clone()),
        S3ProjectUploadAdapter::new(
            macro_aws_config::s3_client().await,
            config.document_storage_bucket.as_ref(),
            config.docx_document_upload_bucket.as_ref(),
            config.upload_staging_bucket.as_ref(),
        ),
        DynamoBulkUploadAdapter::new(dynamodb_client.clone()),
        ShaCountAdapter::new(Redis::new(redis_client.clone())),
        entity_access_management_service.clone(),
        SqsProjectSearchIndexer::new(Arc::new(sqs_client.clone()), macro_event_broker.clone()),
        if cfg!(feature = "local") {
            Some(uuid::uuid!("d50676e2-0a12-4c62-bc07-4b1cb6d8e9bc"))
        } else {
            None
        },
        macro_event_broker.clone(),
    ));

    let document_service = Arc::new(DocumentServiceImpl::new(
        document_repo,
        cloudfront_config,
        sync_service_client.as_ref().clone(),
        s3_upload_adapter,
        TaskPropertiesAdapter {
            system_properties: system_properties_service.clone(),
            properties: properties_service.clone(),
            entity_access_service: entity_access_service.clone(),
        },
        connection_service,
        entity_access_management_service.clone(),
        ForeignEntityServiceImpl::new(PgForeignEntityRepo::new(db.clone())),
        macro_event_broker.clone(),
    ));

    let foreign_entity_service = Arc::new(ForeignEntityServiceImpl::new(PgForeignEntityRepo::new(
        db.clone(),
    )));

    let github_sync_service_impl = GithubSyncServiceImpl::new(
        GithubSyncConfig {
            webhook_secret: config.github_webhook_secret_key.as_ref().to_string(),
            github_sync_app_url: config.github_sync_app_url.to_string(),
            sync_app_pem: config.github_sync_app_pem_secret_key.as_ref().to_string(),
            sync_app_client_id: config.github_sync_app_client_id.to_string(),
            sync_app_client_secret: config.github_sync_app_client_secret.to_string(),
            installation_state_secret: config.github_installation_state_secret.to_string(),
        },
        document_service.clone(),
        foreign_entity_service.clone(),
        (*notification_ingress_service).clone(),
        PgGithubSyncRepo::new(db.clone()),
        GithubSyncClientImpl::default(),
    );

    let foreign_entity_state = ForeignEntityRouterState::new(
        foreign_entity_service.clone(),
        entity_access_service.clone(),
        authorization_state.clone(),
    );

    // Cal.com webhooks → Meta Lead events. Both secrets are loaded here
    // (rather than on Config) to keep cal/Meta wiring colocated.
    let cal_webhook_secret = secretsmanager_client
        .get_maybe_secret_value(env, CalWebhookSecretKey::new()?)
        .await?;
    let cal_event_type_content_names_secret = secretsmanager_client
        .get_maybe_secret_value(env, CalEventTypeContentNamesKey::new()?)
        .await?;

    let analytics_client = Arc::new(AnalyticsClient::new(AnalyticsClientConfig {
        google_analytics: None,
        meta: Some(MetaConfig {
            pixel_id: MetaPixelId::new()?.as_ref().to_string(),
            access_token: MetaAccessToken::new()?.as_ref().to_string(),
            test_event_code: MetaTestEventCode::new().map(|v| v.as_ref().to_string()),
        }),
        posthog: None,
    }));

    let cal_event_type_meta: std::collections::HashMap<u64, CalEventMeta> =
        serde_json::from_str(cal_event_type_content_names_secret.as_ref())
            .context("CalEventTypeContentNames secret must be a JSON object mapping eventTypeId (u64) to { content_name: string, value: number (USD) }")?;
    let cal_webhook_service = CalWebhookServiceImpl::new(
        CalConfig {
            webhook_secret: cal_webhook_secret.as_ref().to_string(),
            event_type_meta: cal_event_type_meta,
        },
        AnalyticsClientSink::new(analytics_client.clone()),
    );
    let cal_webhook_state = CalWebhookRouterState::new(cal_webhook_service);

    // Call service (LiveKit)
    let transcription_agent_name = config
        .livekit_transcription_agent_name
        .value()
        .map(|v| v.to_owned());

    let internal_call_secret = config.internal_call_secret.value().map(|v| v.to_owned());

    anyhow::ensure!(
        transcription_agent_name.is_none() || internal_call_secret.is_some(),
        "LIVEKIT_TRANSCRIPTION_AGENT_NAME is set but INTERNAL_CALL_SECRET is missing — \
         the transcription agent will not be able to submit transcripts"
    );
    let livekit_rtc_client = LivekitRtcClient::new(
        config.livekit_server_url.as_ref(),
        config.livekit_api_key.as_ref(),
        config.livekit_api_secret.as_ref(),
        transcription_agent_name,
    );
    let call_connection_service =
        ConnectionServiceImpl::new(entity_access_service.clone(), connection_gateway.clone());
    let call_repo = PgCallRepo::new(db.clone());
    let egress_config = match (
        config::CallRecordingS3Bucket::new(),
        config::CallRecordingS3Region::new(),
        config::CallRecordingS3AccessKey::new(),
        config::CallRecordingS3Secret::new(),
    ) {
        (Some(bucket), Some(region), Some(access_key), Some(secret)) => {
            tracing::info!(bucket = bucket.as_ref(), "call recording enabled");
            Some(call::domain::models::EgressS3Config {
                bucket: bucket.as_ref().to_string(),
                region: region.as_ref().to_string(),
                access_key: access_key.as_ref().to_string(),
                secret: secret.as_ref().to_string(),
            })
        }
        _ => None,
    };
    let recording_storage = match &egress_config {
        Some(egress_config) => {
            let cloudfront_config = RecordingCloudFrontConfig {
                distribution_url: config
                    .document_storage_service_cloudfront_distribution_url
                    .as_ref()
                    .to_string(),
                signer_public_key_id: config
                    .document_storage_service_cloudfront_signer_public_key_id
                    .as_ref()
                    .to_string(),
                signer_private_key: config
                    .document_storage_service_cloudfront_signer_private_key
                    .as_ref()
                    .to_string(),
                presigned_url_expiry_seconds: config
                    .document_storage_service_presigned_url_expiry_seconds,
            };
            Some(S3RecordingStorage::new(egress_config.bucket.clone(), cloudfront_config).await)
        }
        None => None,
    };
    let mut call_service_builder = CallServiceImpl::<_, _, _, _, _, _, AiCallSummarizer>::new(
        call_repo,
        livekit_rtc_client,
        call_connection_service,
        (*entity_access_service).clone(),
        (*notification_ingress_service).clone(),
        recording_storage,
        config.livekit_server_url.as_ref(),
    )
    .with_summarizer(AiCallSummarizer::new(ai_usage::pg_recorder(db.clone())));
    if let Some(secret) = internal_call_secret {
        call_service_builder = call_service_builder.with_internal_call_secret(secret);
    }
    if let Some(config) = egress_config {
        call_service_builder = call_service_builder.with_egress(config);
    }
    if let Some(base_url) = config::CallRingStatusBaseUrl::new() {
        call_service_builder =
            call_service_builder.with_ring_status_base_url(base_url.as_ref().to_owned());
    }

    // VoIP push is optional: enabled only when both env vars are present.
    // APPLE_BUNDLE_ID:           the app bundle ID (e.g. "com.macro.app.prod")
    // SNS_APNS_VOIP_PLATFORM_ARN: SNS platform app ARN for APNS_VOIP
    //
    // Option<VoipPushServiceImpl<...>> is used as the type parameter so the
    // type stays stable regardless of whether VoIP push is configured.
    let voip_sender = if let (Some(bundle_id), Some(voip_arn)) =
        (AppleBundleId::new(), SnsApnsVoipPlatformArn::new())
    {
        if voip_arn.is_empty() {
            tracing::warn!("voip push disabled: SNS_APNS_VOIP_PLATFORM_ARN is set but empty");
            None
        } else {
            let voip_repo =
                notification::outbound::repository::DbNotificationRepository::new(db.clone());
            let voip_mobile = notification::outbound::mobile::MobilePushAdapter {
                push_service: aws_sdk_sns::Client::new(&aws_config),
                apns_bundle_id: bundle_id.to_string(),
                voip_bundle_id: Some(format!("{}.voip", bundle_id.as_ref())),
            };
            tracing::info!(
                bundle_id = bundle_id.as_ref(),
                voip_arn = voip_arn.as_ref(),
                "voip push enabled"
            );
            Some(notification::domain::service::VoipPushServiceImpl::new(
                voip_repo,
                voip_mobile,
            ))
        }
    } else {
        tracing::info!("voip push disabled: APPLE_BUNDLE_ID or SNS_APNS_VOIP_PLATFORM_ARN not set");
        None
    };
    let call_service_builder = call_service_builder.with_voip_push_sender(voip_sender);

    let call_service = Arc::new(
        call_service_builder
            .with_voice_repo(PgVoiceRepo::new(db.clone()))
            .with_event_broker(macro_event_broker.clone()),
    );

    let call_state = CallRouterState::new(
        call_service.clone(),
        entity_access_service.clone(),
        authorization_state.clone(),
    );
    let call_webhook_state = WebhookRouterState::new(call_service.clone());

    let webhook_repository = webhook::outbound::PgRepository::new(db.clone());
    let webhook_endpoint_scheme_policy = if matches!(env, Environment::Local) {
        webhook::domain::models::WebhookEndpointSchemePolicy::HttpAndHttps
    } else {
        webhook::domain::models::WebhookEndpointSchemePolicy::HttpsOnly
    };
    let webhook_http_client =
        webhook::outbound::ReqwestWebhookDeliveryClient::new_with_endpoint_scheme_policy(
            webhook_endpoint_scheme_policy,
        )
        .context("failed to create webhook HTTP client")?;
    let webhook_service =
        webhook::domain::service::WebhookServiceImpl::new_with_endpoint_scheme_policy(
            webhook_repository.clone(),
            webhook_http_client.clone(),
            webhook_endpoint_scheme_policy,
            macro_event_broker.clone(),
        );
    let webhook_rate_limiter = RateLimitServiceImpl {
        repo: RedisRateLimitAdapter {
            redis: redis_client.clone(),
        },
    };
    let webhook_state = webhook::inbound::axum_router::WebhookRouterState::new(
        webhook_service,
        webhook_rate_limiter,
        authorization_state.clone(),
    );

    let (webhook_stream_sender, _) =
        tokio::sync::broadcast::channel(webhook::domain::stream::WEBHOOK_STREAM_CHANNEL_CAPACITY);
    let sse_stream_service = webhook::domain::stream::WebhookEventStreamServiceImpl::new(
        webhook_stream_sender.clone(),
        entity_access_service.clone(),
        webhook_repository.clone(),
    );
    let sse_stream_state = webhook::inbound::stream_router::WebhookStreamRouterState::new(
        sse_stream_service,
        authorization_state.clone(),
    );
    consumer_tracker.spawn({
        let brokers = config.kafka_brokers.as_ref().to_string();
        let sender = webhook_stream_sender;
        let cancellation_token = consumer_cancellation_token.clone();
        async move {
            loop {
                let result = tokio::select! {
                    biased;
                    _ = cancellation_token.cancelled() => break,
                    result = webhook::inbound::kafka_stream_consumer::run_webhook_stream_consumer(
                        &brokers,
                        &sender,
                    ) => result,
                };

                if cancellation_token.is_cancelled() {
                    break;
                }
                if let Err(error) = result {
                    tracing::error!(
                        error = ?error,
                        "webhook SSE Kafka consumer stopped"
                    );
                    tokio::select! {
                        biased;
                        _ = cancellation_token.cancelled() => break,
                        _ = tokio::time::sleep(Duration::from_secs(1)) => {}
                    }
                }
            }
        }
    });

    let webhook_ingestion_service =
        webhook::domain::ingestion::WebhookEventIngestionServiceImpl::new(
            entity_access_service.clone(),
            webhook_repository,
            webhook_event_queue.clone(),
        );
    let webhook_delivery_repository =
        webhook::outbound::PgWebhookDeliveryRepository::new(db.clone());
    let webhook_delivery_service = webhook::domain::delivery::WebhookEventDeliveryServiceImpl::new(
        webhook_delivery_repository,
        webhook_http_client,
    );
    let webhook_worker = webhook::inbound::worker::WebhookEventWorker::new(
        webhook_event_queue,
        webhook_delivery_service,
    );
    let webhook_worker_task = tokio::spawn(async move {
        tracing::info!("starting webhook event worker");
        webhook_worker.run().await;
    });
    tokio::spawn(async move {
        match webhook_worker_task.await {
            Ok(()) => tracing::error!("webhook event worker exited unexpectedly"),
            Err(error) => {
                tracing::error!(error = ?error, "webhook event worker exited unexpectedly");
            }
        }
    });

    let webhook_consumer_brokers = config.kafka_brokers.as_ref().to_string();
    consumer_tracker.spawn({
        let cancellation_token = consumer_cancellation_token.clone();
        async move {
            loop {
                if cancellation_token.is_cancelled() {
                    break;
                }

                tracing::info!("starting webhook event consumer");
                let result = webhook::inbound::kafka_consumer::run_webhook_event_consumer(
                    &webhook_consumer_brokers,
                    webhook_ingestion_service.clone(),
                    cancellation_token.cancelled(),
                )
                .await;

                if cancellation_token.is_cancelled() {
                    break;
                }

                match result {
                    Ok(()) => tracing::error!("webhook event consumer exited unexpectedly"),
                    Err(error) => {
                        tracing::error!(error = ?error, "webhook event consumer exited unexpectedly");
                    }
                }

                tokio::select! {
                    biased;
                    _ = cancellation_token.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                }
            }
        }
    });

    let activity_consumer_brokers = config.kafka_brokers.as_ref().to_string();
    consumer_tracker.spawn({
        let cancellation_token = consumer_cancellation_token.clone();
        let activity_repo = activity::outbound::pg_activity_repo::PgActivityRepo::new(db.clone());
        async move {
            let consumer = activity::inbound::kafka_consumer::ActivityConsumer::<
                _,
                crate::service::activity::ActivitySourceEvent,
                _,
            >::new(activity_repo, crate::service::activity::ingest);
            loop {
                if cancellation_token.is_cancelled() {
                    break;
                }

                tracing::info!("starting activity consumer");
                let result = consumer
                    .run(&activity_consumer_brokers, cancellation_token.cancelled())
                    .await;

                if cancellation_token.is_cancelled() {
                    break;
                }

                match result {
                    Ok(()) => tracing::error!("activity consumer exited unexpectedly"),
                    Err(error) => {
                        tracing::error!(error = ?error, "activity consumer exited unexpectedly");
                    }
                }

                tokio::select! {
                    biased;
                    _ = cancellation_token.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                }
            }
        }
    });

    let call_internal_state = InternalCallRouterState::new(call_service.clone());

    // Create the SQS worker for delete document processing before config is moved.
    #[cfg(feature = "delete_document_worker")]
    let delete_document_worker = sqs_worker::SQSWorker::new(
        aws_sdk_sqs::Client::new(&aws_config),
        document_delete_queue.to_string(),
        config.queue_max_messages,
        config.queue_wait_time_seconds,
    );

    let call_record_query_service = call::domain::service::CallRecordQueryServiceImpl::new(
        PgCallRepo::new(readonly_db.clone()),
    );
    let foreign_entity_service_for_soup =
        ForeignEntityServiceImpl::new(PgForeignEntityRepo::new(readonly_db.clone()));

    let sqs_client = Arc::new(sqs_client);
    let conn_gateway_client = Arc::new(conn_gateway_client);

    // The OpenAI key is injected as the required `OPENAI_API_KEY` env var
    // (resolved from the `openai-key` secret at deploy time by the infra stack),
    // the same way `document_cognition_service` consumes it. Fail fast if it's
    // empty so the service never starts with a broken task-dedup embedder.
    let openai_api_key = config.openai_api_key.as_ref().to_owned();
    anyhow::ensure!(
        !openai_api_key.trim().is_empty(),
        "OpenAI API key is required for task dedup embeddings",
    );
    let cohere_api_key = config.cohere_api_key.as_ref().to_owned();
    anyhow::ensure!(
        !cohere_api_key.trim().is_empty(),
        "Cohere API key is required for task dedup reranking",
    );
    let task_dedup_service = Arc::new(TaskDedupService::new(
        TextEmbedding3Small::new(openai_api_key),
        PgTaskVectorDb::new(db.clone()),
        CohereReranker::new(cohere_api_key),
        Arc::new(AgentDuplicateJudge::new(ai_usage::pg_recorder(db.clone()))),
        Arc::new(ConnectionGatewayTaskDedupNotifier::new(
            conn_gateway_client.clone(),
        )),
        Arc::new(PgTaskMatchRepo::new(db.clone())),
    ));
    let channels_repo = PgChannelsRepo::new(db.clone());
    let (bot_trigger_sender, bot_trigger_receiver) = tokio::sync::mpsc::unbounded_channel();

    let channel_side_effects = ChannelSideEffectService::new(
        PgChannelSideEffectContext::new(db.clone()),
        ConnectionGatewayChannelRealtimePublisher::new(conn_gateway_client.clone()),
        NotificationChannelSender::new(notification_ingress_service.clone()),
        ContactsChannelDispatcher::new(contacts_ingress.clone()),
    )
    .with_bot_trigger_sender(bot_trigger_sender)
    .with_macro_event_broker(macro_event_broker.clone());

    let channels_service = Arc::new(
        ChannelServiceImpl::with_dependencies(
            channels_repo,
            SpawnedChannelEventDispatcher::new(channel_side_effects.clone()),
            PgChannelReferenceSharePermissions::new(db.clone(), entity_access_service.clone()),
        )
        .with_mention_extractor(lexical_mention_extractor::LexicalMentionExtractor::new(
            lexical_client.clone(),
        )),
    );

    let teammate_dms_brokers = config.kafka_brokers.as_ref().to_string();
    consumer_tracker.spawn({
        let cancellation_token = consumer_cancellation_token.clone();
        let channels = (*channels_service).clone();
        async move {
            loop {
                if cancellation_token.is_cancelled() {
                    break;
                }

                tracing::info!("starting teammate DM consumer");
                let result = channels::inbound::teammate_dms_consumer::run_teammate_dms_consumer(
                    &teammate_dms_brokers,
                    channels.clone(),
                    cancellation_token.cancelled(),
                )
                .await;

                if cancellation_token.is_cancelled() {
                    break;
                }

                match result {
                    Ok(()) => tracing::error!("teammate DM consumer exited unexpectedly"),
                    Err(error) => {
                        tracing::error!(
                            error = ?error,
                            "teammate DM consumer exited unexpectedly"
                        );
                    }
                }

                tokio::select! {
                    biased;
                    _ = cancellation_token.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                }
            }
        }
    });

    // Wire Macro AI to react to mentions with the classic in-channel chat
    // reply. The router posts replies through the channel service we just
    // built and runs the agent loop in-process with the same pre-configured
    // toolset used by other AI hosts. Agent sessions belong to a different
    // bot entirely (`bot_id::MACRO_NEW_BOT_ID`, served by the harness), so
    // the two paths can never answer the same mention.
    let mut macro_agent_tool_context =
        ai_tools::build_tool_service_context_from_env(db.clone(), event_broker_tracker.clone())
            .await
            .context("failed to build Macro agent tool context")?;
    // Wire the agent's SendChannelMessage tool to this service's own
    // side-effect pipeline so agent-posted messages share the exact instance
    // used by the HTTP API, including the in-process bot trigger sender (the
    // env builder wires an equivalent pipeline, but without bot triggers).
    macro_agent_tool_context.channel_tool_context =
        ai_tools::build_channel_tool_context_with_dispatcher(
            db.clone(),
            std::sync::Arc::new(SpawnedChannelEventDispatcher::new(channel_side_effects)),
            lexical_client.clone(),
        );
    let macro_agent_tools = ai_tools::all_tools();
    let bot_trigger_router = channel_bots::inbound::BotTriggerRouter::new(
        channels_service.clone(),
        Arc::new(channel_bots::outbound::AgentLoopResponder::new(
            macro_agent_tool_context,
            macro_agent_tools,
        )),
        Arc::new(
            channel_bots::domain::trigger_detector::MentionOrInferredDetector::new(
                channels_service.clone(),
                Arc::new(channel_bots::outbound::FastModelTriggerClassifier::new(
                    ai_usage::pg_recorder(db.clone()),
                )),
            ),
        ),
    );
    bot_trigger_router.spawn(bot_trigger_receiver);

    let channel_bot_webhook_state =
        bots::inbound::channel_webhook_router::ChannelBotWebhookRouterState::new(
            bots_service.clone(),
            channels_service.clone(),
            (*entity_access_service).clone(),
            authorization_state.clone(),
        );

    // Held by value here and behind an `Arc` in the router state: the impl is a
    // pool handle, so cloning is cheap and `SoupImpl` needs an owned service.
    let reminders_service = RemindersServiceImpl::new(PgRemindersRepo::new(db.clone()));

    let collab_surface_service = CollabSurfaceServiceImpl::new(
        Arc::new(PgCollabSurfaceRepo::new(db.clone())),
        Arc::new(LexicalSyncSurfaceInitializer::new(
            lexical_client.as_ref().clone(),
            sync_service_client.as_ref().clone(),
        )),
        config.document_permission_jwt.as_ref().to_string(),
    );

    let soup_service = Arc::new(SoupImpl::new(
        PgSoupRepo::new(readonly_pool::ReadOnlyPool(readonly_db.clone())),
        frecency_service,
        readonly_email_service,
        channel_service_for_soup,
        call_record_query_service,
        crm_service.clone(),
        foreign_entity_service_for_soup,
        reminders_service.clone(),
    ));

    let websocket_notification_consumer_service =
        Arc::new(WebSocketNotificationConsumerService::new(
            NotificationTopicConsumer::<model_notifications::NotifEvent>::from_env(
                config.kafka_brokers.as_ref(),
            )
            .map_err(|error| {
                anyhow::anyhow!("failed to create WebSocket notification topic consumer: {error:?}")
            })?,
        ));
    consumer_tracker.spawn({
        let service = Arc::clone(&websocket_notification_consumer_service);
        let cancellation_token = consumer_cancellation_token.clone();
        async move {
            loop {
                let result = tokio::select! {
                    biased;
                    _ = cancellation_token.cancelled() => break,
                    result = service.run() => result,
                };

                if cancellation_token.is_cancelled() {
                    break;
                }

                let _ = result.inspect_err(|error| {
                    tracing::error!(
                        error = ?error,
                        "WebSocket notification consumer stopped"
                    );
                });

                tokio::select! {
                    biased;
                    _ = cancellation_token.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {}
                }
            }
        }
    });

    let soup_realtime_service = Arc::new(SoupRealtimeConsumerService::new(
        SoupTopicConsumer::from_env(config.kafka_brokers.as_ref()).map_err(|error| {
            anyhow::anyhow!("failed to create realtime Soup topic consumer: {error:?}")
        })?,
    ));
    consumer_tracker.spawn({
        let soup_realtime_service = Arc::clone(&soup_realtime_service);
        let cancellation_token = consumer_cancellation_token.clone();
        async move {
            loop {
                let result = tokio::select! {
                    biased;
                    _ = cancellation_token.cancelled() => break,
                    result = soup_realtime_service.run() => result,
                };

                if cancellation_token.is_cancelled() {
                    break;
                }

                let _ = result.inspect_err(|error| {
                    tracing::error!(
                        error = ?error,
                        "realtime Soup subscription consumer stopped"
                    );
                });

                tokio::select! {
                    biased;
                    _ = cancellation_token.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {}
                }
            }
        }
    });

    consumer_tracker.spawn({
        let brokers = config.kafka_brokers.as_ref().to_string();
        let entity_access_service = entity_access_service.as_ref().clone();
        let macro_event_broker = macro_event_broker.clone();
        let cancellation_token = consumer_cancellation_token.clone();
        async move {
            let mut consecutive_failures = 0_u32;
            loop {
                if cancellation_token.is_cancelled() {
                    break;
                }

                let fanout_service = SoupRealtimeServiceImpl::new(
                    EntityAccessExpander::new(entity_access_service.clone()),
                    KafkaSoupRealtimePublisher::new(macro_event_broker.clone()),
                );
                tracing::info!("starting realtime Soup entity consumer");
                let result = fanout_service
                    .run_entity_update_consumer(&brokers, cancellation_token.cancelled())
                    .await;

                if cancellation_token.is_cancelled() {
                    break;
                }

                let restart_delay = match result {
                    Ok(()) => {
                        consecutive_failures = 0;
                        tracing::error!("realtime Soup entity consumer exited unexpectedly");
                        soup_consumer_restart_delay(1)
                    }
                    Err(error) => {
                        consecutive_failures = consecutive_failures.saturating_add(1);
                        let restart_delay = soup_consumer_restart_delay(consecutive_failures);
                        if consecutive_failures >= SOUP_CONSUMER_RESTART_ALERT_THRESHOLD {
                            tracing::error!(
                                error = ?error,
                                consecutive_failures,
                                restart_delay_secs = restart_delay.as_secs(),
                                "realtime Soup entity consumer repeatedly failed"
                            );
                        } else {
                            tracing::warn!(
                                error = ?error,
                                consecutive_failures,
                                restart_delay_secs = restart_delay.as_secs(),
                                "realtime Soup entity consumer failed; scheduling restart"
                            );
                        }
                        restart_delay
                    }
                };

                tokio::select! {
                    biased;
                    _ = cancellation_token.cancelled() => break,
                    _ = tokio::time::sleep(restart_delay) => {}
                }
            }
        }
    });

    let favorites_service = Arc::new(FavoritesServiceImpl::new(PgFavoritesRepo::new(db.clone())));
    let user_api_key_service = Arc::new(UserApiKeyServiceImpl::new(PgUserApiKeysRepo::new(
        db.clone(),
    )));
    let calendar_state = CalendarRouterState::new(
        Arc::new(calendar_events::domain::service::CalendarService::new(
            calendar_events::outbound::pg::PgCalendarRepository::new(readonly_db.clone()),
        )),
        authorization_state.clone(),
    );

    // Reminder dispatch. An EventBridge rule drops a sweep tick on this queue
    // every minute; the sweep fans one message out per due firing, onto the
    // same queue, and every task in the pool delivers them in parallel.
    let reminder_dispatch_worker = {
        let queue = SqsDispatchQueue::new(
            aws_sdk_sqs::Client::new(&aws_config),
            reminder_dispatch_queue.to_string(),
        );
        let dispatch_service = ReminderDispatchService::new(
            PgRemindersRepo::new(db.clone()),
            NotificationReminderNotifier::new((*notification_ingress_service).clone()),
            queue.clone(),
        );
        DispatchWorker::new(dispatch_service, queue)
    };

    consumer_tracker.spawn({
        let cancellation_token = consumer_cancellation_token.clone();
        async move {
            tracing::info!("starting reminder dispatch worker");
            reminder_dispatch_worker.run(cancellation_token).await;
            tracing::info!("reminder dispatch worker stopped");
        }
    });

    // Calendar event reminder dispatch: same sweep/deliver shape as reminders,
    // on its own queue. Behind a master switch — when off, the worker drains
    // the minutely tick so the queue neither backs up nor dead-letters.
    let calendar_reminder_dispatch_worker = {
        let queue = SqsCalendarDispatchQueue::new(
            aws_sdk_sqs::Client::new(&aws_config),
            calendar_reminder_dispatch_queue.to_string(),
        );
        let dispatch_service = CalendarReminderDispatchService::new(
            calendar_events::outbound::pg::PgCalendarRepository::new(db.clone()),
            NotificationCalendarReminderNotifier::new((*notification_ingress_service).clone()),
            queue.clone(),
        );
        CalendarReminderDispatchWorker::new(dispatch_service, queue)
    };

    consumer_tracker.spawn({
        let cancellation_token = consumer_cancellation_token.clone();
        let enabled = config.calendar_reminder_dispatch_enabled;
        async move {
            if enabled {
                tracing::info!("starting calendar reminder dispatch worker");
                calendar_reminder_dispatch_worker
                    .run(cancellation_token)
                    .await;
                tracing::info!("calendar reminder dispatch worker stopped");
            } else {
                tracing::info!("calendar reminder dispatch disabled; draining its queue");
                calendar_reminder_dispatch_worker
                    .drain(cancellation_token)
                    .await;
            }
        }
    });

    let redis_sha_client = Arc::new(Redis::new(redis_client));

    let graphql_entity_mutation_service =
        Arc::new(service::entity_mutation::DssEntityMutationService::new(
            document_service.clone(),
            chat_mutation_service,
            channels_service.clone(),
            call_service.clone(),
            Arc::new(email_service.clone()),
            project_service.clone(),
            entity_access_service.clone(),
            favorites_service.clone(),
            Arc::new(outbound::entity_mutation::DssEntityLifecycleAdapter::new(
                db.clone(),
                redis_sha_client.clone(),
                sqs_client.clone(),
                macro_event_broker.clone(),
            )),
        ));

    let api_context = ApiContext {
        contacts_ingress: contacts_ingress.clone(),
        soup_router_state: SoupRouterState::from_arc(
            soup_service.clone(),
            email_service,
            entity_access_service.clone(),
            authorization_state.clone(),
        )
        .with_favorites_reader(Arc::new(
            service::soup_favorites_reader::DssSoupFavoritesReader(favorites_service.clone()),
        )),
        favorites_state: FavoritesRouterState::new(
            favorites_service.clone(),
            entity_access_service.clone(),
            authorization_state.clone(),
        ),
        favorites_service,
        user_api_key_state: UserApiKeyRouterState::new(
            user_api_key_service,
            authorization_state.clone(),
        ),
        reminders_state: RemindersRouterState::new(
            Arc::new(reminders_service),
            entity_access_service.clone(),
            authorization_state.clone(),
        ),
        collab_surface_state: CollabSurfaceRouterState::new(
            Arc::new(collab_surface_service),
            entity_access_service.clone(),
            authorization_state.clone(),
        ),
        graphql_soup_schema: complete_graph::build_schema_from_arcs(
            soup_service,
            soup_realtime_service,
            websocket_notification_consumer_service,
        ),
        graphql_notification_reader,
        // GraphQL reads the activity log through the readonly pool; the
        // Kafka consumer's writer-pool repo above is separate on purpose.
        activity_reader: complete_graph::ActivityPortReader::new(Arc::new(
            activity::outbound::pg_activity_repo::PgActivityRepo::new(readonly_db.clone()),
        )),
        graphql_entity_mutation_service,
        github_sync_service: Arc::new(github_sync_service_impl),
        foreign_entity_state,
        db: db.clone(),
        readonly_db: readonly_pool::ReadOnlyPool(readonly_db.clone()),
        redis_client: redis_sha_client,
        s3_client: s3,
        dynamodb_client: Arc::new(dynamodb_client),
        dynamo_db,
        macro_event_broker: macro_event_broker.clone(),
        sqs_client: sqs_client.clone(),
        notification_ingress_service: notification_ingress_service.clone(),
        conn_gateway_client: conn_gateway_client.clone(),
        sync_service_client: sync_service_client.clone(),
        system_properties_service: system_properties_service.clone(),
        properties_service: properties_service.clone(),
        opensearch_client: Arc::new(opensearch_client),
        authorization_state: authorization_state.clone(),
        jwt_validation_args,
        dss_auth_key,
        // Shared frecency storage and legacy channel list routes.
        frecency_storage,
        channel_list_state,
        entity_access_service: entity_access_service.clone(),
        calendar_state,
        projects_state: ProjectRouterState {
            service: project_service,
            access_service: entity_access_service.clone(),
            authorization_state: authorization_state.clone(),
        },
        documents_state: DocumentRouterState {
            service: document_service.clone(),
            access_service: entity_access_service.clone(),
            authorization_state: authorization_state.clone(),
            pool: db.clone(),
            task_dedup_service,
            lexical_client: lexical_client.clone(),
            creator: documents_hex::domain::create::DocumentCreator::new(
                document_service,
                markdown_initializer,
                documents_hex::outbound::document_bytes_upload::ReqwestDocumentBytesUploader::default(),
            ),
            document_permission_jwt_secret: config.document_permission_jwt.as_ref().to_string(),
        },
        config: Arc::new(config),
        channel_service: channels_service.clone(),
        channels_state: ChannelsRouterState::from_arc(
            channels_service,
            (*entity_access_service).clone(),
            authorization_state.clone(),
        ),
        bots_state: bots::inbound::axum_router::BotsRouterState::new(
            bots_service.clone(),
            (*entity_access_service).clone(),
            authorization_state.clone(),
        ),
        harnesses_state: harnesses::inbound::axum_router::HarnessesRouterState::new(
            harnesses_service,
            authorization_state.clone(),
        ),
        channel_bot_webhook_state,
        call_state,
        call_webhook_state,
        webhook_state,
        sse_stream_state,
        call_internal_state,
        cal_webhook_state,
        entity_access_management_service,
        crm_state: crm::inbound::axum_router::CrmRouterState {
            service: Arc::new(crm_service),
            entity_access_service: entity_access_service.clone(),
            authorization_state: authorization_state.clone(),
        },
    };

    #[cfg(feature = "delete_document_worker")]
    {
        let editing_worker_client = Arc::new(
            documents_hex::outbound::editing_worker_client::ReqwestEditingWorkerClient::from_url(
                AiEditingWorkerUrl::new()?.to_string(),
            )
            .with_internal_auth_key(Some(api_context.config.internal_api_key.to_string())),
        );

        // Spawn the delete document worker.
        let delete_worker_ctx = service::delete_document_worker::DeleteDocumentWorkerContext {
            worker: Arc::new(delete_document_worker),
            db: db.clone(),
            s3_client: api_context.s3_client.clone(),
            redis_client: api_context.redis_client.clone(),
            sync_service_client: api_context.sync_service_client.clone(),
            editing_worker_client,
            properties_service: api_context.properties_service.clone(),
        };

        tokio::spawn(async move {
            service::delete_document_worker::run_worker(delete_worker_ctx).await;
        });
    }

    let server_result = api::setup_and_serve(api_context).await;

    tracing::info!("stopping event consumers");
    consumer_cancellation_token.cancel();
    consumer_tracker.close();
    consumer_tracker.wait().await;
    tracing::info!("event consumers stopped");

    tracing::info!("waiting for event broker publishes to drain");
    event_broker_tracker.close();
    match tokio::time::timeout(EVENT_BROKER_DRAIN_TIMEOUT, event_broker_tracker.wait()).await {
        Ok(()) => tracing::info!("event broker publishes drained"),
        Err(error) => {
            tracing::warn!(
                error=?error,
                timeout_seconds = EVENT_BROKER_DRAIN_TIMEOUT.as_secs(),
                "timed out waiting for event broker publishes to drain"
            );
        }
    }

    server_result
}

const EVENT_BROKER_DRAIN_TIMEOUT: Duration = Duration::from_secs(10);
