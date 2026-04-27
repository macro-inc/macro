#![recursion_limit = "256"]
use crate::{
    api::context::{ApiContext, DocumentStorageServiceAuthKey, TaskPropertiesAdapter},
    config::{
        CalEventTypeContentNamesKey, CalWebhookSecretKey, DocumentPermissionJwtSecretKey,
        DocumentStorageServiceCloudfrontSignerPrivateKeySecretName, GithubSyncAppPemSecretKey,
        GithubWebhookSecretKey, MetaAccessToken, MetaPixelId, MetaTestEventCode,
    },
    service::s3::S3,
};
use analytics_client::{AnalyticsClient, AnalyticsClientConfig, MetaConfig};
use anyhow::Context;
use cal::{
    domain::service::{CalConfig, CalEventMeta, CalWebhookServiceImpl},
    inbound::cal_webhook_router::CalWebhookRouterState,
    outbound::analytics_client::AnalyticsClientSink,
};
use call::{
    domain::service::CallServiceImpl,
    inbound::axum_router::{CallRouterState, InternalCallRouterState, WebhookRouterState},
    outbound::{
        ai_call_summarizer::AiCallSummarizer, livekit_rtc_client::LivekitRtcClient,
        pg_call_repo::PgCallRepo,
    },
};
use channels::{
    domain::service::ChannelMessagesServiceImpl, inbound::axum_router::ChannelsRouterState,
    outbound::pg_channels_repo::PgChannelMessagesRepo,
};
use comms::{
    domain::service::ChannelServiceImpl,
    inbound::CommsRouterState,
    outbound::postgres::{comms_repo::PgCommsRepo, user_repo::PgUserRepo},
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
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use github::domain::service::{GithubSyncConfig, GithubSyncServiceImpl};
use github::outbound::github_sync_client::GithubSyncClientImpl;
use github::outbound::pg_github_sync_repo::PgGithubSyncRepo;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use macro_sha_count_client::Redis;
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use opensearch_client::OpensearchClient;
use properties::{
    NotificationServiceImpl, PermissionServiceImpl, PropertiesPgRepo, PropertiesServiceImpl,
};
use secretsmanager_client::SecretManager;
use soup::{
    domain::service::SoupImpl, inbound::axum_router::SoupRouterState,
    outbound::pg_soup_repo::PgSoupRepo,
};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use sync_service_client::SyncServiceClient;
use system_properties::{PgSystemPropertiesRepository, SystemPropertiesServiceImpl};

mod api;
mod config;
mod model;
mod service;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    let env = Environment::new_or_prod();

    let aws_config = macro_aws_config::get_macro_aws_config().await;

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    let cloudfront_signer_private_key = secretsmanager_client
        .get_maybe_secret_value(
            env,
            DocumentStorageServiceCloudfrontSignerPrivateKeySecretName::new()?,
        )
        .await?;

    let document_permission_jwt_secret = secretsmanager_client
        .get_maybe_secret_value(env, DocumentPermissionJwtSecretKey::new()?)
        .await?;

    // Also get it with the comms_service type for CommsHandlerState
    let comms_permissions_token_secret = secretsmanager_client
        .get_maybe_secret_value(env, comms_service::DocumentPermissionJwtSecretKey::new()?)
        .await?;

    // Parse our configuration from the environment.
    let config = Config::from_env(
        cloudfront_signer_private_key,
        document_permission_jwt_secret,
    )
    .context("expected to be able to generate config")?;

    tracing::trace!("initialized config");

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (50, 150),
        Environment::Develop => (25, 100),
        Environment::Local => (15, 50),
    };

    let db = PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(&config.vars.database_url)
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
        .connect(&config.vars.database_url_readonly)
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
        Some(config.vars.bulk_upload_requests_table.as_ref().to_string()),
    );
    tracing::trace!("initialized dynamodb client");

    let s3_client = macro_aws_config::s3_client().await;

    tracing::trace!("initialized s3 client");

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&aws_config))
        .contacts_queue(&config.vars.contacts_queue)
        .search_event_queue(&config.vars.search_event_queue)
        .document_delete_queue(&config.vars.document_delete_queue);

    tracing::trace!("initialized sqs client");

    // Redis handles it own connection pool internally. Each time we use redis
    // we should be using redis_client.get_connection() to grab a specific connection
    let redis_client = redis::Client::open(config.vars.redis_uri.as_ref())
        .expect("could not connect to redis client");

    match redis_client.get_connection().is_err() {
        true => {
            tracing::error!("unable to connect to redis");
        }
        false => {
            tracing::trace!("initialized redis connection");
        }
    }

    let internal_api_secret = secretsmanager_client
        .get_maybe_secret_value(config.environment, InternalApiSecretKey::new()?)
        .await?;

    let dss_auth_key = DocumentStorageServiceAuthKey::new()?;

    let conn_gateway_client = ConnectionGatewayClient::new(
        internal_api_secret.as_ref().to_string(),
        config.vars.connection_gateway_url.as_ref().to_string(),
    );

    let sync_service_auth_key = match config.environment {
        Environment::Local => config.vars.sync_service_auth_key.as_ref().to_string(),
        _ => secretsmanager_client
            .get_secret_value(&config.vars.sync_service_auth_key)
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    let sync_service_client = SyncServiceClient::new(
        sync_service_auth_key,
        config.vars.sync_service_url.as_ref().to_string(),
    );

    let jwt_validation_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    // Initialize OpenSearch client
    let opensearch_password = match config.environment {
        Environment::Local => config.vars.opensearch_password.as_ref().to_string(),
        _ => secretsmanager_client
            .get_secret_value(&config.vars.opensearch_password)
            .await
            .context("unable to get opensearch secret")?
            .to_string(),
    };

    let opensearch_client = OpensearchClient::new(
        config.vars.opensearch_url.as_ref().to_string(),
        config.vars.opensearch_username.as_ref().to_string(),
        opensearch_password,
    )
    .context("unable to create opensearch client")?;

    if let Err(e) = opensearch_client.health().await {
        tracing::error!(error=?e, "error connecting to opensearch");
        return Err(e);
    }
    tracing::trace!("initialized opensearch client");

    let frecency_storage = FrecencyPgStorage::new(db.clone());
    let frecency_service = FrecencyQueryServiceImpl::new(frecency_storage.clone());
    let email_service = EmailServiceImpl::new(
        EmailPgRepo::new(db.clone()),
        frecency_service.clone(),
        email::domain::ports::NoOpEnqueuer,
        0,
    );
    let readonly_email_service = ReadonlyEmailPreviewAdapter(EmailServiceImpl::new(
        EmailPgRepo::new(readonly_db.clone()),
        frecency_service.clone(),
        email::domain::ports::NoOpEnqueuer,
        0,
    ));
    let system_properties_service =
        SystemPropertiesServiceImpl::new(PgSystemPropertiesRepository::new(db.clone()));
    let ingress_queue = SqsQueue::new(
        aws_sdk_sqs::Client::new(&aws_config),
        config.vars.notification_queue.as_ref().to_string(),
    );
    let notification_ingress_service = Arc::new(SqsNotificationIngress {
        queue: ingress_queue.clone(),
    });
    tracing::trace!("initialized notification ingress service");

    let entity_access_service = Arc::new(
        entity_access::domain::service::EntityAccessServiceImpl::new(
            entity_access::outbound::PgAccessRepository::new(db.clone()),
        ),
    );

    let permission_checker = PermissionServiceImpl::new(db.clone(), entity_access_service.clone());
    let notification_service = NotificationServiceImpl::new(SqsNotificationIngress {
        queue: ingress_queue,
    });
    let properties_service = Arc::new(PropertiesServiceImpl::new(
        PropertiesPgRepo::new(db.clone()),
        Some(permission_checker),
        Some(notification_service),
    ));

    // Create the ChannelServiceImpl - we need to create separate instances as it doesn't impl Clone
    let channel_service_for_soup = ChannelServiceImpl::new(
        PgCommsRepo::new(readonly_pool::ReadOnlyPool(readonly_db.clone())),
        PgUserRepo::new(readonly_db.clone()),
        frecency_storage.clone(),
    );
    let channel_service_for_comms = ChannelServiceImpl::new(
        PgCommsRepo::new(readonly_pool::ReadOnlyPool(db.clone())),
        PgUserRepo::new(db.clone()),
        frecency_storage.clone(),
    );

    // Create the CommsRouterState for comms_service routes
    let comms_state = CommsRouterState::new(channel_service_for_comms);

    let s3 = Arc::new(S3::new(
        s3_client,
        config.vars.document_storage_bucket.as_ref(),
        config.vars.docx_document_upload_bucket.as_ref(),
        config.vars.upload_staging_bucket.as_ref(),
    ));
    let system_properties_service = Arc::new(system_properties_service);

    let document_repo = PgDocumentRepo::new(db.clone());
    let cloudfront_config = CloudFrontConfig {
        distribution_url: config
            .vars
            .document_storage_service_cloudfront_distribution_url
            .as_ref()
            .to_string(),
        signer_public_key_id: config
            .vars
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
        config.vars.document_storage_bucket.as_ref(),
        config.vars.docx_document_upload_bucket.as_ref(),
    );

    let connection_gateway = Arc::new(ConnectionGatewayImpl::new(conn_gateway_client.clone()));

    let connection_service =
        ConnectionServiceImpl::new(entity_access_service.clone(), connection_gateway.clone());

    let entity_access_management_service =
        entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
            entity_access_management::outbound::PgRepository::new(db.clone()),
        );

    let document_service = Arc::new(DocumentServiceImpl::new(
        document_repo,
        cloudfront_config,
        sync_service_client.clone(),
        s3_upload_adapter,
        TaskPropertiesAdapter {
            system_properties: system_properties_service.clone(),
            properties: properties_service.clone(),
        },
        connection_service,
        entity_access_management_service.clone(),
    ));

    let github_webhook_secret = secretsmanager_client
        .get_maybe_secret_value(env, GithubWebhookSecretKey::new()?)
        .await?;

    let github_sync_app_pem = secretsmanager_client
        .get_maybe_secret_value(env, GithubSyncAppPemSecretKey::new()?)
        .await?;

    let github_sync_service_impl = GithubSyncServiceImpl::new(
        GithubSyncConfig {
            webhook_secret: github_webhook_secret.as_ref().to_string(),
            github_sync_app_url: config.vars.github_sync_app_url.to_string(),
            sync_app_pem: github_sync_app_pem.as_ref().to_string(),
            sync_app_client_id: config.vars.github_sync_app_client_id.to_string(),
        },
        document_service.clone(),
        PgGithubSyncRepo::new(db.clone()),
        GithubSyncClientImpl::default(),
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
    let transcription_agent_name =
        config::LivekitTranscriptionAgentName::new().map(|v| v.as_ref().to_owned());
    let internal_call_secret = config::InternalCallSecret::new().map(|v| v.as_ref().to_owned());
    anyhow::ensure!(
        transcription_agent_name.is_none() || internal_call_secret.is_some(),
        "LIVEKIT_TRANSCRIPTION_AGENT_NAME is set but INTERNAL_CALL_SECRET is missing — \
         the transcription agent will not be able to submit transcripts"
    );
    let livekit_rtc_client = LivekitRtcClient::new(
        config.vars.livekit_server_url.as_ref(),
        config.vars.livekit_api_key.as_ref(),
        config.vars.livekit_api_secret.as_ref(),
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
        Some(config) => Some(
            call::outbound::s3_recording_storage::S3RecordingStorage::new(config.bucket.clone())
                .await,
        ),
        None => None,
    };
    let mut call_service_builder = CallServiceImpl::<_, _, _, _, _, _, AiCallSummarizer>::new(
        call_repo,
        livekit_rtc_client,
        call_connection_service,
        (*entity_access_service).clone(),
        (*notification_ingress_service).clone(),
        recording_storage,
        config.vars.livekit_server_url.as_ref(),
    )
    .with_summarizer(AiCallSummarizer::new());
    if let Some(secret) = internal_call_secret {
        call_service_builder = call_service_builder.with_internal_call_secret(secret);
    }
    if let Some(config) = egress_config {
        call_service_builder = call_service_builder.with_egress(config);
    }

    let call_search_indexer = crate::service::call_search_indexer::SqsCallSearchIndexer::new(
        Arc::new(sqs_client.clone()),
    );
    let call_service = Arc::new(call_service_builder.with_search_indexer(call_search_indexer));

    let call_state = CallRouterState::new(call_service.clone(), entity_access_service.clone());
    let call_webhook_state = WebhookRouterState::new(call_service.clone());
    let call_internal_state = InternalCallRouterState::new(call_service.clone());

    // Create the SQS worker for delete document processing before config is moved
    let delete_document_worker = sqs_worker::SQSWorker::new(
        aws_sdk_sqs::Client::new(&aws_config),
        config.vars.document_delete_queue.as_ref().to_string(),
        config.queue_max_messages,
        config.queue_wait_time_seconds,
    );

    let call_record_query_service = call::domain::service::CallRecordQueryServiceImpl::new(
        PgCallRepo::new(readonly_db.clone()),
    );

    let api_context = ApiContext {
        soup_router_state: SoupRouterState::new(
            SoupImpl::new(
                PgSoupRepo::new(readonly_pool::ReadOnlyPool(readonly_db.clone())),
                frecency_service,
                readonly_email_service,
                channel_service_for_soup,
                call_record_query_service,
            ),
            email_service,
        ),
        github_sync_service: Arc::new(github_sync_service_impl),
        db: db.clone(),
        readonly_db: readonly_pool::ReadOnlyPool(readonly_db.clone()),
        redis_client: Arc::new(Redis::new(redis_client)),
        s3_client: s3,
        dynamodb_client: Arc::new(dynamodb_client),
        dynamo_db,
        sqs_client: Arc::new(sqs_client),
        notification_ingress_service,
        conn_gateway_client: Arc::new(conn_gateway_client),
        sync_service_client: Arc::new(sync_service_client),
        system_properties_service: system_properties_service.clone(),
        properties_service: properties_service.clone(),
        opensearch_client: Arc::new(opensearch_client),
        config: Arc::new(config),
        jwt_validation_args,
        dss_auth_key,
        // Comms service fields
        frecency_storage,
        comms_state,
        permissions_token_secret: comms_permissions_token_secret,
        entity_access_service: entity_access_service.clone(),
        documents_state: DocumentRouterState {
            service: document_service,
            access_service: entity_access_service.clone(),
            pool: db.clone(),
        },
        channels_state: ChannelsRouterState::new(
            ChannelMessagesServiceImpl::new(PgChannelMessagesRepo::new(db.clone())),
            (*entity_access_service).clone(),
        ),
        call_state,
        call_webhook_state,
        call_internal_state,
        cal_webhook_state,
        entity_access_management_service,
    };

    // Spawn the delete document worker
    let delete_worker_ctx = service::delete_document_worker::DeleteDocumentWorkerContext {
        worker: Arc::new(delete_document_worker),
        db: db.clone(),
        s3_client: api_context.s3_client.clone(),
        redis_client: api_context.redis_client.clone(),
        sync_service_client: api_context.sync_service_client.clone(),
    };

    tokio::spawn(async move {
        service::delete_document_worker::run_worker(delete_worker_ctx).await;
    });

    api::setup_and_serve(api_context).await?;

    Ok(())
}
