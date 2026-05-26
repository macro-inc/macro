#![recursion_limit = "256"]
use crate::api::context::ApiContext;
use crate::api::user_notification::BLOCKABLE_NOTIFICATIONS;
use ::notification::domain::models::email_notification_digest::ports::DigestBatch;
use ::notification::domain::service::NotificationEgressService;
use ::notification::inbound::notification_events_listener::NotificationEventsListener;
use ::notification::inbound::worker::NotificationWorker;
use ::notification::outbound::email::EmailAdapter;
use ::notification::outbound::mobile::MobilePushAdapter;
use ::notification::outbound::notification_events::PgNotificationEventsReceiver;
use ::notification::outbound::rate_limit::RedisRateLimitAdapter;
use ::notification::outbound::websocket::{ConnectionGatewayClient, WebSocketGatewayAdapter};
use ::rate_limit::RateLimitServiceImpl;
use anyhow::Context;
use config::Config;
use email_formatting::EmailDigestNotification;
use hmac::{Hmac, Mac};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::SecretManager;
use sha2::Sha256;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;

mod api;
mod config;
mod env;
mod model;
mod notification;

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

    let unsubscribe_hmac_secret = secretsmanager_client
        .get_maybe_secret_value(config.environment, config::UrlSigningHmac::new()?)
        .await?;

    let vars = config::Vars::new()?;

    let hmac_key = Hmac::<Sha256>::new_from_slice(unsubscribe_hmac_secret.as_ref().as_bytes())
        .expect("HMAC accepts any key size");

    let redis_client =
        redis::Client::open(vars.redis_uri.as_ref()).expect("failed to create redis client");

    #[cfg(feature = "push_notification_event_handler")]
    {
        let event_notif_repo =
            ::notification::outbound::repository::DbNotificationRepository::new(db.clone());
        let event_sns_manager =
            ::notification::outbound::sns_endpoint::SnsEndpointManagerAdapter::new(
                aws_sdk_sns::Client::new(&aws_config),
            );

        let push_event_redis_conn = redis_client
            .get_multiplexed_async_connection()
            .await
            .context("failed to get redis connection for push event digest state machine")?;

        let digest_failure_sm =
            ::notification::domain::models::email_notification_digest::StateMachineDriverC {
                message_receipt_repo:
                    ::notification::outbound::message_receipt_repository::DbMessageReceiptRepository::new(
                        db.clone(),
                    ),
                digest_batcher: ::notification::outbound::digest_batcher::RedisDigestBatcher::new(
                    push_event_redis_conn,
                ),
                notif_repo:
                    ::notification::outbound::repository::DbNotificationRepository::new(db.clone()),
                digest_window: std::time::Duration::from_secs(30 * 60),
            };

        let event_service = ::notification::domain::service::PushNotificationEventService::new(
            event_notif_repo,
            event_sns_manager,
            digest_failure_sm,
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

    let notification_repository =
        ::notification::outbound::repository::DbNotificationRepository::new(db.clone());

    let notification_queue = ::notification::outbound::queue::SqsQueue::new(
        aws_sdk_sqs::Client::new(&aws_config),
        vars.notification_queue.as_ref().to_string(),
    );
    let sns_endpoint_manager =
        ::notification::outbound::sns_endpoint::SnsEndpointManagerAdapter::new(
            aws_sdk_sns::Client::new(&aws_config),
        );
    let platform_config = ::notification::domain::service::PlatformArnConfig {
        apns_platform_arn: config.sns_apns_platform_arn.clone(),
        fcm_platform_arn: config.sns_fcm_platform_arn.clone(),
        apns_voip_platform_arn: config.sns_apns_voip_platform_arn.clone(),
    };
    let reader_realtime_adapter = WebSocketGatewayAdapter::new(ConnectionGatewayClient::new(
        internal_secret_key.as_ref().to_string(),
        vars.connection_gateway_url.as_ref().to_string(),
    ));
    let notification_events_realtime_adapter =
        WebSocketGatewayAdapter::new(ConnectionGatewayClient::new(
            internal_secret_key.as_ref().to_string(),
            vars.connection_gateway_url.as_ref().to_string(),
        ));
    let notification_events_receiver = PgNotificationEventsReceiver::new(db.clone());
    let mut notification_events_listener = NotificationEventsListener::new(
        notification_events_receiver,
        notification_events_realtime_adapter,
    );
    tokio::spawn(async move {
        tracing::info!("starting notification database event listener");
        notification_events_listener.run().await
    });

    let reader_service = ::notification::domain::service::NotificationReaderService {
        repository: notification_repository,
        queue: notification_queue.clone(),
        sns_endpoint: sns_endpoint_manager,
        platform_config,
        realtime: reader_realtime_adapter,
    };
    let ingress_state = ::notification::inbound::http::NotificationRouterState::new(
        reader_service,
        &BLOCKABLE_NOTIFICATIONS,
        hmac_key.clone(),
        jwt_args.clone(),
    );

    // Set up egress worker for delivering notifications from the queue
    let egress_repository =
        ::notification::outbound::repository::DbNotificationRepository::new(db.clone());

    let websocket_adapter = WebSocketGatewayAdapter::new(ConnectionGatewayClient::new(
        internal_secret_key.as_ref().to_string(),
        vars.connection_gateway_url.as_ref().to_string(),
    ));

    let mobile_adapter = MobilePushAdapter {
        push_service: aws_sdk_sns::Client::new(&aws_config),
        apns_bundle_id: vars.apple_bundle_id.as_ref().to_string(),
        voip_bundle_id: None,
    };

    let ses_client = aws_sdk_sesv2::Client::new(&aws_config);
    let email_adapter = EmailAdapter::new(ses_client, crate::env::SENDER_ADDRESS.clone());

    let redis_multiplexed_conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .context("failed to get multiplexed redis connection for egress state machine")?;
    let rate_limit_adapter = RateLimitServiceImpl {
        repo: RedisRateLimitAdapter {
            redis: redis_client,
        },
    };

    let egress_state_machine =
        ::notification::domain::models::email_notification_digest::StateMachineDriverB {
            message_receipt_repo:
                ::notification::outbound::message_receipt_repository::DbMessageReceiptRepository::new(
                    db.clone(),
                ),
            digest_batcher: ::notification::outbound::digest_batcher::RedisDigestBatcher::new(
                redis_multiplexed_conn.clone(),
            ),
            digest_window: std::time::Duration::from_secs(30 * 60),
        };

    let egress_digest_batcher =
        ::notification::outbound::digest_batcher::RedisDigestBatcher::new(redis_multiplexed_conn);

    let egress_service = NotificationEgressService {
        queue: notification_queue,
        repository: egress_repository,
        websocket: websocket_adapter,
        mobile: mobile_adapter,
        email: email_adapter,
        rate_limiter: rate_limit_adapter,
        state_machine: egress_state_machine,
        digest_batcher: egress_digest_batcher,
    };

    let worker = Arc::new(NotificationWorker::new(egress_service));

    let worker_clone = worker.clone();
    tokio::spawn(async move {
        tracing::info!("starting notification egress worker");
        worker_clone.run_notifications().await
    });

    let env = config.environment;
    let digest_batch_to_email = move |batch: DigestBatch| {
        EmailDigestNotification::new_from_digest_batch(batch, env, hmac_key.clone())
    };

    tokio::spawn(async move {
        tracing::info!("starting digest worker");
        worker.run_digests(digest_batch_to_email).await
    });

    // Set up ingress worker for processing notification requests from the ingress queue
    let ingress_redis_conn = redis::Client::open(vars.redis_uri.as_ref())
        .expect("failed to create redis client for ingress")
        .get_multiplexed_async_connection()
        .await
        .context("failed to get redis connection for ingress state machine")?;

    let ingress_state_machine =
        ::notification::domain::models::email_notification_digest::StateMachineDriverA::new_with_defaults(
            ::notification::outbound::user_existence_checker::DbUserExistenceChecker::new(
                db.clone(),
            ),
            ::notification::outbound::push_notification_checker::PushNotificationCheckerImpl::new(
                ::notification::outbound::repository::DbNotificationRepository::new(db.clone()),
            ),
            ::notification::outbound::last_online_checker::LastOnlineCheckerImpl::new(
                last_online_tracker::domain::services::LastOnlineService::new(
                    last_online_tracker::outbound::time::DefaultTime,
                    last_online_tracker::outbound::redis::RedisLastOnlineRepo::new(
                        ingress_redis_conn.clone(),
                    ),
                ),
            ),
            ::notification::outbound::digest_batcher::RedisDigestBatcher::new(ingress_redis_conn),
            model_notifications::digest_state::digest_email_block_list(),
        );

    let ingress_repository =
        ::notification::outbound::repository::DbNotificationRepository::new(db.clone());
    let ingress_delivery_queue = ::notification::outbound::queue::SqsQueue::new(
        aws_sdk_sqs::Client::new(&aws_config),
        vars.notification_queue.as_ref().to_string(),
    );
    let ingress_service = ::notification::domain::service::NotificationIngressService::new(
        ingress_repository,
        ingress_delivery_queue,
        ingress_state_machine,
    );

    let ingress_queue = ::notification::outbound::queue::SqsQueue::new(
        aws_sdk_sqs::Client::new(&aws_config),
        vars.notification_ingress_queue.as_ref().to_string(),
    );
    let ingress_worker =
        ::notification::inbound::ingress_worker::IngressWorker::new(ingress_service, ingress_queue);

    tokio::spawn(async move {
        tracing::info!("starting notification ingress worker");
        ingress_worker.run().await
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
