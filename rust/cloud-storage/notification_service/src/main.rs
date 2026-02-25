use crate::api::context::ApiContext;
use ::notification::domain::service::NotificationEgressService;
use ::notification::inbound::worker::NotificationWorker;
use ::notification::outbound::email::EmailAdapter;
use ::notification::outbound::mobile::MobilePushAdapter;
use ::notification::outbound::rate_limit::RedisRateLimitAdapter;
use ::notification::outbound::websocket::{ConnectionGatewayClient, WebSocketGatewayAdapter};
use anyhow::Context;
use config::Config;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::SecretManager;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;

mod api;
mod config;
#[allow(dead_code)]
mod env;
mod model;
mod notification;
#[allow(dead_code)]
mod templates;

#[tokio::main]
pub async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    // Parse our configuration from the environment.
    let config = Config::from_env().context("expected to be able to generate config")?;

    tracing::trace!("initialized config");

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (5, 30),
        Environment::Develop => (1, 25),
        Environment::Local => (1, 10),
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

    let aws_config = macro_aws_config::get_macro_aws_config().await;

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    let internal_secret_key = secretsmanager_client
        .get_maybe_secret_value(config.environment, InternalApiSecretKey::new()?)
        .await?;

    #[cfg(feature = "push_notification_event_handler")]
    {
        let device_deleter =
            ::notification::outbound::device_registration::DbDeviceRegistrationDeleter::new(
                db.clone(),
            );
        let sns_deleter = ::notification::outbound::sns_endpoint::SnsEndpointDeletionAdapter::new(
            aws_sdk_sns::Client::new(&aws_config),
        );
        let event_service = ::notification::domain::service::PushNotificationEventService::new(
            device_deleter,
            sns_deleter,
        );
        let event_queue =
            ::notification::outbound::push_notification_event_queue::SqsPushNotificationEventQueue::new(
                aws_sdk_sqs::Client::new(&aws_config),
                config.push_notification_event_handler_queue.clone(),
                config.notification_queue_max_messages,
                config.notification_queue_wait_time_seconds,
            );
        let event_worker =
            ::notification::inbound::push_notification_event_worker::PushNotificationEventWorker::new(
                event_service,
                event_queue,
            );
        tokio::spawn(async move { event_worker.run().await });
    }

    let sns_client = sns_client::SNS::new(aws_sdk_sns::Client::new(&aws_config));

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    let vars = config::Vars::new()?;
    let notification_repository =
        ::notification::outbound::repository::DbNotificationRepository::new(db.clone());

    let notification_queue = ::notification::outbound::queue::SqsNotificationQueue::new(
        aws_sdk_sqs::Client::new(&aws_config),
        vars.notification_queue.as_ref().to_string(),
    );
    let reader_service = ::notification::domain::service::NotificationReaderService::new(
        notification_repository,
        notification_queue.clone(),
    );
    let ingress_state = ::notification::inbound::http::NotificationRouterState::new(reader_service);

    // Set up egress worker for delivering notifications from the queue
    let egress_repository =
        ::notification::outbound::repository::DbNotificationRepository::new(db.clone());

    let websocket_adapter = WebSocketGatewayAdapter::new(ConnectionGatewayClient::new(
        internal_secret_key.as_ref().to_string(),
        vars.connection_gateway_url.as_ref().to_string(),
    ));

    let mobile_adapter = MobilePushAdapter::new(
        aws_sdk_sns::Client::new(&aws_config),
        vars.apple_bundle_id.as_ref().to_string(),
    );

    let ses_client = aws_sdk_sesv2::Client::new(&aws_config);
    let email_adapter = EmailAdapter::new(ses_client, config.sender_base_address.clone());

    let redis_client =
        redis::Client::open(vars.redis_uri.as_ref()).expect("failed to create redis client");
    let redis_multiplexed_conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .context("failed to get multiplexed redis connection for egress state machine")?;
    let rate_limit_adapter = RedisRateLimitAdapter::new(redis_client);

    let egress_state_machine =
        ::notification::domain::models::email_notification_digest::StateMachineDriverB {
            message_receipt_repo:
                ::notification::outbound::message_receipt_repository::DbMessageReceiptRepository::new(
                    db.clone(),
                ),
            digest_batcher: ::notification::outbound::digest_batcher::RedisDigestBatcher::new(
                redis_multiplexed_conn,
            ),
            digest_window: std::time::Duration::from_secs(30 * 60),
        };

    let egress_service = NotificationEgressService::new(
        notification_queue,
        egress_repository,
        websocket_adapter,
        mobile_adapter,
        email_adapter,
        rate_limit_adapter,
        egress_state_machine,
    );

    let worker = NotificationWorker::new(egress_service);

    tokio::spawn(async move {
        tracing::info!("starting notification egress worker");
        worker.run().await
    });

    api::setup_and_serve(
        ApiContext {
            db,
            sns_client: Arc::new(sns_client),
            config: Arc::new(config),
            jwt_args,
            internal_secret_key,
        },
        ingress_state,
    )
    .await?;

    Ok(())
}
