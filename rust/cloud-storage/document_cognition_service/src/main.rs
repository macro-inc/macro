use crate::api::context::ApiContext;
use anyhow::Context;
use comms::domain::service::ChannelServiceImpl;
use comms::outbound::postgres::comms_repo::PgCommsRepo;
use comms::outbound::postgres::user_repo::PgUserRepo;
use comms_service_client::CommsServiceClient;
use config::{Config, EnvVars, Environment};
use document_cognition_service_client::DocumentCognitionServiceClient;
use document_storage_service_client::DocumentStorageServiceClient;
use email::domain::service::EmailServiceImpl;
use email::outbound::EmailPgRepo;
use email_service_client::{EmailServiceClient, EmailServiceClientExternal};
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::outbound::postgres::FrecencyPgStorage;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use notification::domain::models::email_notification_digest::{
    EmailBlockList, ExplicitInviteAllowList, NotificationSetBuilder, StateMachineDriverA,
};
use notification::domain::service::NotificationIngressService;
use notification::outbound::{
    digest_batcher::RedisDigestBatcher, last_online_checker::LastOnlineCheckerImpl,
    push_notification_checker::PushNotificationCheckerImpl, queue::SqsNotificationQueue,
    repository::DbNotificationRepository, user_existence_checker::DbUserExistenceChecker,
};
use scribe::{ScribeClient, document::DocumentClient};
use search_service_client::SearchServiceClient;
use secretsmanager_client::SecretManager;
use soup::domain::service::SoupImpl;
use soup::outbound::pg_soup_repo::PgSoupRepo;
use sqlx::postgres::PgPoolOptions;
use static_file_service_client::StaticFileServiceClient;
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
    // Comms service is now served from document_storage_service under /comms prefix
    let comms_service_client = CommsServiceClient::new(config.document_storage_service_url.clone());

    tracing::info!("initialized comms client");
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
        sync_service_auth_key,
        config.lexical_service_url.clone(),
    ));

    let email_service_client = Arc::new(EmailServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.email_service_url.clone(),
    ));

    let document_cognition_service_client = Arc::new(DocumentCognitionServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.document_cognition_service_url.clone(),
    ));

    let static_file_service_client = Arc::new(StaticFileServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.static_file_service_url.clone(),
    ));

    tracing::info!("initialized static file service client");

    // Build soup service
    let frecency_storage = FrecencyPgStorage::new(db.clone());
    let frecency_service = FrecencyQueryServiceImpl::new(frecency_storage.clone());
    let email_service = EmailServiceImpl::new(
        EmailPgRepo::new(db.clone()),
        frecency_service.clone(),
        email::domain::ports::NoOpEnqueuer,
        email::domain::ports::NoOpGmailLabelModifier,
        0,
    );
    let channels_service = ChannelServiceImpl::new(
        PgCommsRepo { pool: db.clone() },
        PgUserRepo::new(db.clone()),
        frecency_storage,
    );
    let soup_service = Arc::new(SoupImpl::new(
        PgSoupRepo::new(db.clone()),
        frecency_service,
        email_service,
        channels_service,
    ));

    tracing::info!("initialized soup service");

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
        connection_gateway_client::service::dynamodb::create_dynamo_db_connection_manager(
            dynamodb_client,
        )
        .await
        .context("failed to create connection manager")?;

    tracing::info!("initialized connection repo");

    let redis_multiplexed_conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .context("failed to get multiplexed redis connection for notification state machine")?;

    let notification_ingress_service = Arc::new({
        let notification_repository = DbNotificationRepository::new(db.clone());
        let notification_queue = SqsNotificationQueue::new(
            aws_sdk_sqs::Client::new(&aws_config),
            config.notification_queue.clone(),
        );
        let state_machine = StateMachineDriverA {
            user_checker: DbUserExistenceChecker::new(db.clone()),
            notification_checker: PushNotificationCheckerImpl::new(DbNotificationRepository::new(
                db.clone(),
            )),
            online_checker: LastOnlineCheckerImpl::new(
                last_online_tracker::domain::services::LastOnlineService::new(
                    last_online_tracker::outbound::time::DefaultTime,
                    last_online_tracker::outbound::redis::RedisLastOnlineRepo::new(
                        redis_multiplexed_conn.clone(),
                    ),
                ),
            ),
            digest_batcher: RedisDigestBatcher::new(redis_multiplexed_conn.clone()),
            block_list: EmailBlockList::new::<model_notifications::NewEmailMetadata>(),
            invite_list: ExplicitInviteAllowList::new::<model_notifications::InviteToTeamMetadata>(
            )
            .append::<model_notifications::ChannelInviteMetadata>(),
            digest_window: std::time::Duration::from_secs(30 * 60),
            online_duration_threshold: std::time::Duration::from_secs(60 * 60),
        };
        NotificationIngressService::new(notification_repository, notification_queue, state_machine)
    });

    tracing::info!("initialized notification ingress service");

    api::setup_and_serve(ApiContext {
        db: db.clone(),
        email_service_client_external: Arc::new(EmailServiceClientExternal::new(
            email_service_client.url().to_owned(),
        )),
        scribe: Arc::new(
            ScribeClient::new()
                .with_document_client(
                    DocumentClient::builder()
                        .with_dss_client(document_storage_client.clone())
                        .with_lexical_client(lexical_client)
                        .with_sync_service_client(sync_service_client.clone())
                        .with_macro_db(db.clone())
                        .build(),
                )
                .with_channel_client_and_db(comms_service_client.clone(), db.clone())
                .with_dcs_client(document_cognition_service_client)
                .with_email_client(email_service_client)
                .with_static_file_client(static_file_service_client.clone()),
        ),
        sqs_client: Arc::new(sqs_client),
        document_storage_client: Arc::new(document_storage_client),
        comms_service_client: Arc::new(comms_service_client),
        search_service_client: Arc::new(search_service_client),
        jwt_args,
        config: Arc::new(config),
        internal_auth_key,
        notification_ingress_service,
        connection_repo: connection_manager.persistence,
        soup_service,
        stream_repo,
    })
    .await
    .context("failed to setup and serve api")?;
    Ok(())
}
