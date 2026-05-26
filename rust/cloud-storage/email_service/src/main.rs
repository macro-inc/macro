#![recursion_limit = "256"]
use crate::api::context::ApiContext;
use anyhow::Context;
use document_storage_service_client::DocumentStorageServiceClient;
use email::{
    domain::service::EmailServiceImpl,
    inbound::axum::{
        axum_impls::GmailTokenState, get_thread_router::EmailThreadRouterState,
        previews_router::EmailRouterState,
    },
    outbound::{EmailPgRepo, GmailTokenProviderImpl},
};
use email_service::config::EmailServiceCloudfrontSignerPrivateKey;
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::{LocalOrRemoteSecret, SecretManager};
use sqlx::postgres::PgPoolOptions;
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;
use system_properties::{PgSystemPropertiesRepository, SystemPropertiesServiceImpl};

mod api;
mod utils;

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    let env = Environment::new_or_prod();

    let aws_config = macro_aws_config::get_macro_aws_config().await;

    let s3_client = s3_client::S3::new(macro_aws_config::s3_client().await);

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    let cloudfront_signer_private_key = secretsmanager_client
        .get_maybe_secret_value(env, EmailServiceCloudfrontSignerPrivateKey::new()?)
        .await?;

    // Parse our configuration from the environment.
    let config = email_service::config::Config::from_env(cloudfront_signer_private_key)
        .context("expected to be able to generate config")?;

    let auth_service_secret_key = match config.environment {
        Environment::Local => config.auth_service_secret_key.clone(),
        _ => secretsmanager_client
            .get_secret_value(config.auth_service_secret_key.clone())
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    // limiting to max of 200 connections (12.5% of macrodb total) in prod.
    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (3, 20),
        Environment::Develop => (1, 10),
        Environment::Local => (1, 10),
    };

    let db = PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(&config.macro_db_url)
        .await
        .context("could not connect to db")?;

    let sqs_client = sqs_client::SQS::new(macro_aws_config::sqs_client().await)
        .gmail_inbox_sync_queue(&config.gmail_inbox_sync_queue)
        .gmail_inbox_sync_retry_queue(&config.gmail_inbox_sync_retry_queue)
        .gmail_ops_queue(&config.gmail_ops_queue)
        .search_event_queue(&config.search_event_queue)
        .email_backfill_queue(&config.backfill_queue)
        .email_scheduled_queue(&config.email_scheduled_queue)
        .sfs_uploader_queue(&config.sfs_uploader_queue)
        .email_link_manager_queue(&config.link_manager_queue);

    let auth_service_client = authentication_service_client::AuthServiceClient::new(
        auth_service_secret_key,
        config.auth_service_url.clone(),
    );

    let gmail_client = gmail_client::GmailClient::new(config.gmail_gcp_queue.clone());

    let redis_inner_client = redis::Client::open(config.redis_uri.as_str())
        .inspect(|client| {
            client
                .get_connection()
                .map(|_| tracing::info!("initialized redis connection"))
                .inspect_err(|e| {
                    tracing::error!(error=?e, "failed to connect to redis");
                })
                .ok();
        })
        .context("failed to connect to redis")?;

    let redis_client = email_service::util::redis::RedisClient::new(
        redis_inner_client,
        config.redis_rate_limit_reqs,
        config.redis_rate_limit_reqs_backfill,
        config.redis_rate_limit_window_secs,
    );

    let internal_auth_key = InternalApiSecretKey::new()?;

    let sfs_client = StaticFileServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.static_file_service_url.clone(),
    );

    let dss_client = DocumentStorageServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.document_storage_service_url.clone(),
    );

    let system_properties_service = Arc::new(SystemPropertiesServiceImpl::new(
        PgSystemPropertiesRepository::new(db.clone()),
    ));

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    let sqs_client = Arc::new(sqs_client);
    let gmail_client = Arc::new(gmail_client);
    // HTTP API only reads CRM rows — populate runs in the pubsub
    // worker. The no-op resolver makes the unused branch explicit and
    // keeps reqwest/scraper out of this binary.
    let crm_service = crm::domain::service::CrmServiceImpl::new(
        crm::outbound::companies_repo::CompaniesRepositoryImpl::new(db.clone()),
        crm::outbound::no_op_resolver::NoOpCompanyMetadataResolver,
    );
    let email_service = EmailRouterState::new(EmailServiceImpl::new(
        EmailPgRepo::new(db.clone()),
        FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(db.clone())),
        (*sqs_client).clone(),
        crm_service,
        config.sent_undo_delay_secs,
    ));
    let entity_access_service = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        db.clone(),
    )));
    let email_thread_state = EmailThreadRouterState {
        service: email_service.service(),
        access_service: entity_access_service.clone(),
    };
    let auth_service_client = Arc::new(auth_service_client);
    let redis_conn = redis_client
        .inner
        .get_multiplexed_async_connection()
        .await
        .context("failed to get multiplexed redis connection for gmail token provider")?;
    let redis_client = Arc::new(redis_client);
    let gmail_token_state = GmailTokenState::new(GmailTokenProviderImpl::new(
        redis_conn,
        auth_service_client.clone(),
    ));
    api::setup_and_serve(ApiContext {
        db,
        config: Arc::new(config),
        auth_service_client,
        redis_client,
        sqs_client,
        sfs_client: Arc::new(sfs_client),
        gmail_client: gmail_client.clone(),
        s3_client: Arc::new(s3_client),
        dss_client: Arc::new(dss_client),
        system_properties_service,
        jwt_args,
        internal_auth_key: LocalOrRemoteSecret::Local(internal_auth_key),
        email_service,
        entity_access_service,
        email_thread_state,
        gmail_token_state,
    })
    .await?;
    Ok(())
}
