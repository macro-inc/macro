#![recursion_limit = "256"]
use std::{sync::Arc, time::Duration};

use ai_routines::AiRoutineTrigger;
use anyhow::{Context, Result};
use axum::Router;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, PgUserApiKeyAuthorizationRepo, PgUserApiKeyAuthorizer,
};
use macro_entrypoint::MacroEntrypoint;
use macro_event_broker::{KafkaEventPublisher, MacroEventBrokerService};
use scheduled_action::config::Config;
use scheduled_action::domain::ports::ScheduledActionDispatcher;
use scheduled_action::domain::service::ScheduledActionServiceImpl;
use scheduled_action::inbound::axum_router::{
    ScheduledActionRouterState, health, scheduled_action_router,
};
use scheduled_action::outbound::kafka_routine_executor::KafkaRoutineExecutor;
use scheduled_action::outbound::pg_polling_dispatcher::{
    PgPollingDispatcher, PgPollingDispatcherLifecycle,
};
use scheduled_action::outbound::pg_scheduled_action_repo::PgScheduledActionRepo;
use scheduled_action::swagger::ApiDoc;
use sqlx::postgres::PgPoolOptions;
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

#[cfg(test)]
mod test;

const EVENT_BROKER_DRAIN_TIMEOUT: Duration = Duration::from_secs(10);
const GATEWAY_PATH_PREFIX: &str = "/scheduled-action";

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> Result<()> {
    MacroEntrypoint::default().init();

    let config = Config::from_env()?;
    let environment = config.environment;

    let db = PgPoolOptions::new()
        .min_connections(3)
        .max_connections(10)
        .connect(&config.database_url)
        .await
        .context("failed to connect to macrodb")?;

    // Due actions become run requests on the ai-routines topic; the tracker
    // lets shutdown wait for publishes still in flight.
    let event_broker_tracker = TaskTracker::new();
    let publisher = Arc::new(MacroEventBrokerService::new(
        KafkaEventPublisher::new(config.kafka_brokers.as_ref())
            .context("failed to build the kafka publisher")?,
        event_broker_tracker.clone(),
    ));

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&macro_aws_config::get_macro_aws_config().await),
    );

    let repo = Arc::new(PgScheduledActionRepo::new(db.clone()));

    // The dispatcher consumes its executor, so build a second one for the
    // service's run-now requests. They differ only in the trigger they stamp
    // on the request.
    let dispatcher_executor = KafkaRoutineExecutor::new(
        Arc::clone(&repo),
        Arc::clone(&publisher),
        AiRoutineTrigger::Schedule,
    );
    let service_executor = Arc::new(KafkaRoutineExecutor::new(
        Arc::clone(&repo),
        publisher,
        AiRoutineTrigger::Manual,
    ));

    let dispatcher_cancellation_token = CancellationToken::new();
    let dispatcher_tracker = TaskTracker::new();
    let dispatcher_lifecycle = PgPollingDispatcherLifecycle::new(
        dispatcher_cancellation_token.clone(),
        dispatcher_tracker.clone(),
    );
    let dispatcher = PgPollingDispatcher::new(Arc::clone(&repo), dispatcher_executor)
        .with_lifecycle(dispatcher_lifecycle);
    let (dispatcher_tx, _execution_rx) = dispatcher.begin_dispatch_loop();

    let service = Arc::new(ScheduledActionServiceImpl::new(
        Arc::clone(&repo),
        service_executor,
        dispatcher_tx,
    ));

    let jwt_args = JwtValidationArgs::new_with_secret_manager(environment, &secretsmanager_client)
        .await
        .context("failed to build jwt validation args")?;

    let authorization_service = MacroAuthorizationServiceImpl::new(
        MacroAuthJwtValidator::new(jwt_args),
        InternalAuthConfig {
            api_key: config.internal_api_key.to_string(),
            default_user_id: None,
        },
        macro_authorization::NoBotAuthorizer,
        PgUserApiKeyAuthorizer::new(PgUserApiKeyAuthorizationRepo::new(db.clone())),
    );
    let authorization_state = MacroAuthorizationState::new(Arc::new(authorization_service));

    let state = ScheduledActionRouterState {
        service,
        authorization_state,
    };
    let authed_routes = scheduled_action_router::<_, _, ()>(state);

    let router = Router::new()
        .merge(mount_at_root_and_prefix(
            Router::new()
                .route("/health", axum::routing::get(health))
                .merge(authed_routes),
        ))
        .merge(mount_docs_at_root_and_prefix())
        .layer(macro_cors::cors_layer());

    let port = config.port;
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("failed to bind {addr}"))?;

    tracing::info!("scheduled_action service listening on {addr}");

    let server_result = axum::serve(listener, router.into_make_service())
        .with_graceful_shutdown(macro_entrypoint::shutdown_signal())
        .await
        .context("server closed");

    tracing::info!("stopping scheduled action dispatcher");
    dispatcher_cancellation_token.cancel();
    dispatcher_tracker.close();
    dispatcher_tracker.wait().await;
    tracing::info!("scheduled action dispatcher stopped");

    tracing::info!("waiting for event broker publishes to drain");
    event_broker_tracker.close();
    match tokio::time::timeout(EVENT_BROKER_DRAIN_TIMEOUT, event_broker_tracker.wait()).await {
        Ok(()) => tracing::info!("event broker publishes drained"),
        Err(error) => {
            tracing::warn!(
                error=?error,
                timeout_seconds = EVENT_BROKER_DRAIN_TIMEOUT.as_secs(),
                "timed out waiting for event broker publishes to drain"
            );
        }
    }

    server_result
}

fn mount_at_root_and_prefix(inner: Router) -> Router {
    Router::new()
        .merge(inner.clone())
        .nest(GATEWAY_PATH_PREFIX, inner)
}

fn mount_docs_at_root_and_prefix() -> Router {
    Router::new()
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", ApiDoc::openapi()))
        .merge(SwaggerUi::new(format!("{GATEWAY_PATH_PREFIX}/docs")).url(
            format!("{GATEWAY_PATH_PREFIX}/api-doc/openapi.json"),
            ApiDoc::openapi(),
        ))
}
