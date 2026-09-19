#![recursion_limit = "256"]
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use calendar_events::{
    domain::{mutations::CalendarMutationServiceImpl, service::CalendarService},
    outbound::{google::GoogleCalendarClient, pg::PgCalendarRepository},
};
use calendar_service::api::context::{ApiContext, AuthorizationService};
use calendar_service::backfill_queue::CalendarBackfillQueueClient;
use calendar_service::calendar_backfill::CalendarBackfillContext;
use calendar_service::calendar_backfill_adapters::RedisCalendarRequestGate;
use calendar_service::calendar_ratelimit::CalendarRateLimiter;
use calendar_service::calendar_refresh::ConnectionGatewayCalendarRefresh;
use calendar_service::calendar_tokens::CalendarTokenProviderAdapter;
use calendar_service::config::{Config, calendar_watch_config};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationState,
    PgUserApiKeyAuthorizationRepo, PgUserApiKeyAuthorizer,
};
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use macro_event_broker::{KafkaEventPublisher, MacroEventBrokerService};
use macro_service_urls::{AuthServiceUrl, ConnectionGatewayUrl};
use sqlx::postgres::PgPoolOptions;
use tokio_util::{sync::CancellationToken, task::TaskTracker};

const EVENT_BROKER_DRAIN_TIMEOUT: Duration = Duration::from_secs(10);

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    let env = Environment::new_or_prod();

    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    let config = Config::from_env()
        .context("expected to be able to generate config")?
        .resolve_remote_secrets(env, &secretsmanager_client)
        .await
        .context("expected to be able to resolve config secrets")?;

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

    // One long-lived multiplexed connection shared by the token adapters;
    // cloning it is an Arc bump, not a new TCP dial per provider call.
    let redis_conn = redis_inner_client
        .get_multiplexed_async_connection()
        .await
        .context("failed to get multiplexed redis connection for token sources")?;

    let auth_service_client = authentication_service_client::AuthServiceClient::new(
        config
            .authentication_service_secret_key
            .as_ref()
            .to_string(),
        AuthServiceUrl::new()?.to_string(),
    );

    let connection_gateway_client = connection_gateway_client::client::ConnectionGatewayClient::new(
        config.internal_api_key.to_string(),
        ConnectionGatewayUrl::new()?.to_string(),
    );

    let event_broker_tracker = TaskTracker::new();
    let macro_event_broker = MacroEventBrokerService::new(
        KafkaEventPublisher::new(config.kafka_brokers.as_ref())
            .context("failed to create kafka event publisher")?,
        event_broker_tracker.clone(),
    );

    let worker_cancellation_token = CancellationToken::new();
    let worker_tracker = TaskTracker::new();

    let backfill_queue = macro_queues::CalendarServiceBackfillQueue::new();
    let backfill_queue_client = CalendarBackfillQueueClient::new(
        aws_sdk_sqs::Client::new(&aws_config),
        backfill_queue.to_string(),
    );
    let rate_limiter =
        CalendarRateLimiter::new(redis_inner_client, config.redis_rate_limit_window_secs);

    // Sync scheduler + calendar outbox drain.
    worker_tracker.spawn(calendar_service::calendar_outbox::run(
        db.clone(),
        backfill_queue_client,
        calendar_events::domain::service::GoogleCalendarSyncScheduler::new(
            PgCalendarRepository::new(db.clone()),
        ),
        config.calendar_sync_enabled,
        worker_cancellation_token.clone(),
    ));

    // Calendar backfill queue consumers.
    for _ in 0..config.backfill_queue_workers {
        let worker = sqs_worker::SQSWorker::new(
            aws_sdk_sqs::Client::new(&aws_config),
            backfill_queue.to_string(),
            config.backfill_queue_max_messages,
            config.queue_wait_time_seconds,
        );
        let ctx = CalendarBackfillContext::new(
            db.clone(),
            worker.clone(),
            rate_limiter.clone(),
            redis_conn.clone(),
            auth_service_client.clone(),
            connection_gateway_client.clone(),
            macro_event_broker.clone(),
            calendar_watch_config(),
            config.calendar_sync_enabled,
        );
        let cancellation_token = worker_cancellation_token.clone();
        worker_tracker.spawn(async move {
            calendar_service::calendar_backfill::run_worker(ctx, worker, cancellation_token).await;
        });
    }
    tracing::info!(
        num_workers = config.backfill_queue_workers,
        "calendar backfill workers started"
    );

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;
    let authorization_state = MacroAuthorizationState::new(Arc::new(AuthorizationService::new(
        MacroAuthJwtValidator::new(jwt_args),
        InternalAuthConfig {
            api_key: config.internal_api_key.to_string(),
            default_user_id: None,
        },
        macro_authorization::NoBotAuthorizer,
        PgUserApiKeyAuthorizer::new(PgUserApiKeyAuthorizationRepo::new(db.clone())),
    )));

    let calendar_service = Arc::new(CalendarService::new(PgCalendarRepository::new(db.clone())));
    let calendar_mutation_service = Arc::new(CalendarMutationServiceImpl::new(
        PgCalendarRepository::new(db.clone()),
        GoogleCalendarClient::with_gate(
            reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .context("failed to build the google calendar mutation http client")?,
            RedisCalendarRequestGate::new(rate_limiter),
        ),
        CalendarTokenProviderAdapter::new(redis_conn, Arc::new(auth_service_client)),
        macro_event_broker.clone(),
        ConnectionGatewayCalendarRefresh::new(connection_gateway_client, db.clone()),
    ));

    let api_result = calendar_service::api::setup_and_serve(ApiContext {
        config: Arc::new(config),
        authorization_state,
        calendar_service,
        calendar_mutation_service,
    })
    .await;

    worker_cancellation_token.cancel();
    worker_tracker.close();
    tracing::info!("waiting for calendar workers to stop");
    worker_tracker.wait().await;
    tracing::info!("calendar workers stopped");

    event_broker_tracker.close();
    tracing::info!("waiting for event broker publishes to drain");
    match tokio::time::timeout(EVENT_BROKER_DRAIN_TIMEOUT, event_broker_tracker.wait()).await {
        Ok(()) => tracing::info!("event broker publishes drained"),
        Err(error) => tracing::warn!(
            error = ?error,
            timeout_seconds = EVENT_BROKER_DRAIN_TIMEOUT.as_secs(),
            "timed out waiting for event broker publishes to drain"
        ),
    }

    api_result
}
