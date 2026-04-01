#![recursion_limit = "256"]
use crate::{
    api::context::{ApiContext, DocumentStorageServiceAuthKey, TaskPropertiesAdapter},
    config::{
        DocumentPermissionJwtSecretKey, DocumentStorageServiceCloudfrontSignerPrivateKeySecretName,
        GithubSyncAppPemSecretKey, GithubWebhookSecretKey,
    },
    service::s3::S3,
};
use anyhow::Context;
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
use notification::outbound::queue::SqsIngressQueue;
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
        email::domain::ports::NoOpGmailLabelModifier,
        0,
    );
    let readonly_email_service = ReadonlyEmailPreviewAdapter(EmailServiceImpl::new(
        EmailPgRepo::new(readonly_db.clone()),
        frecency_service.clone(),
        email::domain::ports::NoOpEnqueuer,
        email::domain::ports::NoOpGmailLabelModifier,
        0,
    ));
    let system_properties_service =
        SystemPropertiesServiceImpl::new(PgSystemPropertiesRepository::new(db.clone()));
    let ingress_queue = SqsIngressQueue {
        client: aws_sdk_sqs::Client::new(&aws_config),
        queue_url: config.vars.notification_queue.as_ref().to_string(),
    };
    let notification_ingress_service = Arc::new(SqsNotificationIngress {
        queue: ingress_queue.clone(),
    });
    tracing::trace!("initialized notification ingress service");

    let permission_checker = PermissionServiceImpl::new(db.clone());
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

    let entity_access_service = Arc::new(
        entity_access::domain::service::EntityAccessServiceImpl::new(
            entity_access::outbound::PgAccessRepository::new(db.clone()),
        ),
    );

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

    let connection_service = ConnectionServiceImpl::new(
        entity_access_service.clone(),
        Arc::new(ConnectionGatewayImpl::new(conn_gateway_client.clone())),
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

    // Create the SQS worker for delete document processing before config is moved
    let delete_document_worker = sqs_worker::SQSWorker::new(
        aws_sdk_sqs::Client::new(&aws_config),
        config.vars.document_delete_queue.as_ref().to_string(),
        config.queue_max_messages,
        config.queue_wait_time_seconds,
    );

    let api_context = ApiContext {
        soup_router_state: SoupRouterState::new(
            SoupImpl::new(
                PgSoupRepo::new(readonly_pool::ReadOnlyPool(readonly_db.clone())),
                frecency_service,
                readonly_email_service,
                channel_service_for_soup,
            ),
            email_service,
        ),
        github_sync_service: Arc::new(github_sync_service_impl),
        db: db.clone(),
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
