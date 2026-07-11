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
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use macro_service_urls::{AuthServiceUrl, DocumentStorageServiceUrl, StaticFileServiceUrl};
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

    // Parse our configuration from the environment, then resolve any secret-manager backed values.
    let config = email_service::config::Config::from_env()
        .context("expected to be able to generate config")?
        .resolve_remote_secrets(env, &secretsmanager_client)
        .await
        .context("expected to be able to resolve config secrets")?;

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

    let gmail_inbox_sync_queue = macro_queues::GmailInboxSyncQueue::new();
    let gmail_inbox_sync_retry_queue = macro_queues::GmailInboxSyncRetryQueue::new();
    let gmail_ops_queue = macro_queues::GmailOpsQueue::new();
    let search_event_queue = macro_queues::SearchEventQueue::new();
    let backfill_queue = macro_queues::EmailBackfillQueue::new();
    let email_scheduled_queue = macro_queues::EmailScheduledQueue::new();
    let sfs_uploader_queue = macro_queues::SfsUploaderQueue::new();
    let link_manager_queue = macro_queues::LinkManagerQueue::new();
    let sqs_client = sqs_client::SQS::new(macro_aws_config::sqs_client().await)
        .gmail_inbox_sync_queue(&gmail_inbox_sync_queue)
        .gmail_inbox_sync_retry_queue(&gmail_inbox_sync_retry_queue)
        .gmail_ops_queue(&gmail_ops_queue)
        .search_event_queue(&search_event_queue)
        .email_backfill_queue(&backfill_queue)
        .email_scheduled_queue(&email_scheduled_queue)
        .sfs_uploader_queue(&sfs_uploader_queue)
        .email_link_manager_queue(&link_manager_queue);

    let auth_service_client = authentication_service_client::AuthServiceClient::new(
        config
            .authentication_service_secret_key
            .as_ref()
            .to_string(),
        AuthServiceUrl::new()?.to_string(),
    );

    let gmail_client = gmail_client::GmailClient::new(config.gmail_gcp_queue.as_ref().to_string());

    let redis_inner_client = redis::Client::open(config.redis_uri.as_ref())
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

    let sfs_client = StaticFileServiceClient::new(
        config.internal_api_key.to_string(),
        StaticFileServiceUrl::new()?.to_string(),
    );

    let dss_client = DocumentStorageServiceClient::new(
        config.internal_api_key.to_string(),
        DocumentStorageServiceUrl::new()?.to_string(),
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
        entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
            entity_access_management::outbound::PgRepository::new(db.clone()),
        ),
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
        internal_api_key: config.internal_api_key.clone(),
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
        email_service,
        entity_access_service,
        email_thread_state,
        gmail_token_state,
    })
    .await?;
    Ok(())
}
