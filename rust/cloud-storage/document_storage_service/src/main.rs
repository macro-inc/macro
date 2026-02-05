use crate::{
    api::context::{ApiContext, DocumentStorageServiceAuthKey},
    config::{
        DocumentPermissionJwtSecretKey, DocumentStorageServiceCloudfrontSignerPrivateKeySecretName,
    },
    service::s3::S3,
};
use anyhow::Context;
use comms::{
    domain::service::ChannelServiceImpl,
    inbound::CommsRouterState,
    outbound::{http::user_repo::UserRepoImpl, postgres::comms_repo::PgCommsRepo},
};
use config::{Config, Environment};
use connection_gateway_client::client::ConnectionGatewayClient;
use dynamodb_client::DynamodbClient;
use email::{domain::service::EmailServiceImpl, outbound::EmailPgRepo};
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use macro_sha_count_client::Redis;
use notification::domain::service::NotificationIngressService;
use notification::outbound::{queue::SqsNotificationQueue, repository::DbNotificationRepository};
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
        Environment::Production => (25, 75),
        Environment::Develop => (3, 20),
        Environment::Local => (3, 10),
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

    let dynamo_db = aws_sdk_dynamodb::Client::new(&aws_config);

    let dynamodb_client = DynamodbClient::new_from_client(
        dynamo_db.clone(),
        Some(config.vars.bulk_upload_requests_table.as_ref().to_string()),
    );
    tracing::trace!("initialized dynamodb client");

    let s3_client = aws_sdk_s3::Client::new(&aws_config);

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

    let auth_service_secret_key = match config.environment {
        Environment::Local => config
            .vars
            .authentication_service_secret_key
            .as_ref()
            .to_string(),
        _ => secretsmanager_client
            .get_secret_value(&config.vars.authentication_service_secret_key)
            .await
            .context("unable to get auth service secret")?
            .to_string(),
    };

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
    let email_service =
        EmailServiceImpl::new(EmailPgRepo::new(db.clone()), frecency_service.clone());
    let system_properties_service =
        SystemPropertiesServiceImpl::new(PgSystemPropertiesRepository::new(db.clone()));
    let make_notification_ingress = || {
        let notification_repository = DbNotificationRepository::new(db.clone());
        let notification_queue = SqsNotificationQueue::new(
            aws_sdk_sqs::Client::new(&aws_config),
            config.vars.notification_queue.as_ref().to_string(),
        );
        NotificationIngressService::new(notification_repository, notification_queue)
    };
    let notification_ingress_service = Arc::new(make_notification_ingress());
    tracing::trace!("initialized notification ingress service");

    let permission_checker = PermissionServiceImpl::new(db.clone());
    let notification_service = NotificationServiceImpl::new(make_notification_ingress());
    let properties_service = PropertiesServiceImpl::new(
        PropertiesPgRepo::new(db.clone()),
        Some(permission_checker),
        Some(notification_service),
    );

    // Create the ChannelServiceImpl - we need to create separate instances as it doesn't impl Clone
    let auth_service_url: reqwest::Url = config
        .vars
        .authentication_service_url
        .as_ref()
        .parse()
        .context("AUTHENTICATION_SERVICE_URL must be a valid url")?;
    let channel_service_for_soup = ChannelServiceImpl::new(
        PgCommsRepo { pool: db.clone() },
        UserRepoImpl::new(auth_service_secret_key.clone(), auth_service_url.clone()),
        frecency_storage.clone(),
    );
    let channel_service_for_comms = ChannelServiceImpl::new(
        PgCommsRepo { pool: db.clone() },
        UserRepoImpl::new(auth_service_secret_key, auth_service_url),
        frecency_storage.clone(),
    );

    // Create the CommsRouterState for comms_service routes
    let comms_state = CommsRouterState::new(channel_service_for_comms);

    let api_context = ApiContext {
        soup_router_state: SoupRouterState::new(
            SoupImpl::new(
                PgSoupRepo::new(db.clone()),
                frecency_service,
                email_service.clone(),
                channel_service_for_soup,
            ),
            email_service,
        ),
        db: db.clone(),
        redis_client: Arc::new(Redis::new(redis_client)),
        s3_client: Arc::new(S3::new(
            s3_client,
            config.vars.document_storage_bucket.as_ref(),
            config.vars.docx_document_upload_bucket.as_ref(),
            config.vars.upload_staging_bucket.as_ref(),
        )),
        dynamodb_client: Arc::new(dynamodb_client),
        dynamo_db,
        sqs_client: Arc::new(sqs_client),
        notification_ingress_service,
        conn_gateway_client: Arc::new(conn_gateway_client),
        sync_service_client: Arc::new(sync_service_client),
        system_properties_service: Arc::new(system_properties_service),
        properties_service: Arc::new(properties_service),
        opensearch_client: Arc::new(opensearch_client),
        config: Arc::new(config),
        jwt_validation_args,
        dss_auth_key,
        // Comms service fields
        frecency_storage,
        comms_state,
        permissions_token_secret: comms_permissions_token_secret,
    };

    api::setup_and_serve(api_context).await?;

    Ok(())
}
