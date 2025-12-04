use crate::{
    api::context::{ApiContext, DocumentStorageServiceAuthKey},
    config::{CloudfrontSignerPrivateKeySecretName, DocumentPermissionJwtSecretKey},
    service::s3::S3,
};
use anyhow::Context;
use comms_service_client::CommsServiceClient;
use config::{Config, Environment};
use connection_gateway_client::client::ConnectionGatewayClient;
use dynamodb_client::DynamodbClient;
use email::{domain::service::EmailServiceImpl, outbound::EmailPgRepo};
use email_service_client::EmailServiceClient;
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_env_var::env_var;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use macro_redis_cluster_client::Redis;
use secretsmanager_client::SecretManager;
use soup::{
    domain::service::SoupImpl, inbound::axum_router::SoupRouterState,
    outbound::pg_soup_repo::PgSoupRepo,
};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use sync_service_client::SyncServiceClient;

mod api;
mod config;
mod model;
mod service;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    let env = Environment::new_or_prod();

    let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    let cloudfront_signer_private_key = secretsmanager_client
        .get_maybe_secret_value(env, CloudfrontSignerPrivateKeySecretName::new()?)
        .await?;

    let document_permission_jwt_secret = secretsmanager_client
        .get_maybe_secret_value(env, DocumentPermissionJwtSecretKey::new()?)
        .await?;

    // Parse our configuration from the environment.
    let config = Config::from_env(
        cloudfront_signer_private_key,
        document_permission_jwt_secret,
    )
    .context("expected to be able to generate config")?;

    tracing::trace!("initialized config");

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (10, 50),
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

    // Create DynamoDB client with local endpoint for local environment
    // If DynamoEndpointUrl is not set, use AWS DynamoDB even in local mode
    let dynamo_db = if matches!(config.environment, Environment::Local) {
        env_var!(
            struct DynamoEndpointUrl;
        );
        match DynamoEndpointUrl::new() {
            Ok(endpoint_url) => {
                tracing::info!("Using local DynamoDB endpoint: {}", endpoint_url.as_ref());
                let local_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
                    .region("us-east-1")
                    .endpoint_url(endpoint_url.to_string())
                    .load()
                    .await;
                aws_sdk_dynamodb::Client::new(&local_config)
            }
            Err(_) => {
                tracing::info!("DynamoEndpointUrl not set, using AWS DynamoDB");
                aws_sdk_dynamodb::Client::new(&aws_config)
            }
        }
    } else {
        aws_sdk_dynamodb::Client::new(&aws_config)
    };

    let dynamodb_client = DynamodbClient::new_from_client(
        dynamo_db.clone(),
        Some(config.vars.bulk_upload_requests_table.as_ref().to_string()),
    );
    tracing::trace!("initialized dynamodb client");

    let s3_client = aws_sdk_s3::Client::new(&aws_config);

    tracing::trace!("initialized s3 client");

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&aws_config))
        .search_event_queue(&config.vars.search_event_queue)
        .document_delete_queue(&config.vars.document_delete_queue);

    tracing::trace!("initialized sqs client");

    // Redis handles it own connection pool internally. Each time we use redis
    // we should be using redis_client.get_connection() to grab a specific connection
    let redis_client = redis::cluster::ClusterClient::new(vec![config.vars.redis_uri.as_ref()])
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

    let macro_notify_client = macro_notify::MacroNotify::new(
        config.vars.notification_queue.as_ref().to_string(),
        "document_storage_service".to_string(),
    )
    .await;
    tracing::trace!("initialized macro_notify client");

    let dss_auth_key = DocumentStorageServiceAuthKey::new()?;

    let comms_service_client = CommsServiceClient::new(
        dss_auth_key.as_ref().to_string(),
        config.vars.comms_service_url.as_ref().to_string(),
    );

    let email_service_client = EmailServiceClient::new(
        dss_auth_key.as_ref().to_string(),
        config.vars.email_service_url.as_ref().to_string(),
    );

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

    let frecency_service = FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(db.clone()));
    let email_service =
        EmailServiceImpl::new(EmailPgRepo::new(db.clone()), frecency_service.clone());
    let api_context = ApiContext {
        soup_router_state: SoupRouterState::new(
            SoupImpl::new(
                PgSoupRepo::new(db.clone()),
                frecency_service,
                email_service.clone(),
            ),
            email_service,
        ),
        db,
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
        macro_notify_client: Arc::new(macro_notify_client),
        email_service_client: Arc::new(email_service_client),
        comms_service_client: Arc::new(comms_service_client),
        conn_gateway_client: Arc::new(conn_gateway_client),
        sync_service_client: Arc::new(sync_service_client),
        config: Arc::new(config),
        jwt_validation_args,
        dss_auth_key,
    };

    api::setup_and_serve(api_context).await?;

    Ok(())
}
