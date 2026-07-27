#![recursion_limit = "256"]
use std::{future::pending, sync::Arc, time::Duration};

use ai_tools::build_tool_service_context_from_env;
use anyhow::{Context, Result};
use axum::Router;
use connection_gateway_client::client::ConnectionGatewayClient;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState,
};
use macro_entrypoint::MacroEntrypoint;
use macro_service_urls::ConnectionGatewayUrl;
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use scheduled_action::config::Config;
use scheduled_action::domain::ports::ScheduledActionDispatcher;
use scheduled_action::domain::service::ScheduledActionServiceImpl;
use scheduled_action::inbound::axum_router::{
    ScheduledActionRouterState, health, scheduled_action_router,
};
use scheduled_action::outbound::conn_gateway_live_updates::ConnGatewayLiveUpdates;
use scheduled_action::outbound::inprocess_executor::InProcessExecutor;
use scheduled_action::outbound::pg_polling_dispatcher::PgPollingDispatcher;
use scheduled_action::outbound::pg_scheduled_action_repo::PgScheduledActionRepo;
use scheduled_action::swagger::ApiDoc;
use sqlx::postgres::PgPoolOptions;
use tokio_util::task::TaskTracker;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

const EVENT_BROKER_DRAIN_TIMEOUT: Duration = Duration::from_secs(10);

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

    let event_broker_tracker = TaskTracker::new();
    let tool_context =
        build_tool_service_context_from_env(db.clone(), event_broker_tracker.clone())
            .await
            .context("failed to build tool service context")?;

    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let notification_ingress = Arc::new(SqsNotificationIngress {
        queue: SqsQueue::new(
            aws_sdk_sqs::Client::new(&aws_config),
            macro_queues::NotificationIngressQueue::new().to_string(),
        ),
    });

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&macro_aws_config::get_macro_aws_config().await),
    );
    let conn_gateway_client = Arc::new(ConnectionGatewayClient::new(
        config.internal_api_key.to_string(),
        ConnectionGatewayUrl::new()?.to_string(),
    ));
    let live_updates = Arc::new(ConnGatewayLiveUpdates::new(Arc::clone(
        &conn_gateway_client,
    )));

    let repo = Arc::new(PgScheduledActionRepo::new(db.clone()));

    // The dispatcher consumes its executor, so build a second executor for the
    // service to use when handling execute-now requests. Both executors share
    // the underlying repo/pool/tool-context via cheap Arc/PgPool clones.
    let dispatcher_executor = InProcessExecutor::new(
        Arc::clone(&repo),
        db.clone(),
        tool_context.clone(),
        Arc::clone(&notification_ingress),
        Arc::clone(&live_updates),
    );
    let service_executor = Arc::new(InProcessExecutor::new(
        Arc::clone(&repo),
        db.clone(),
        tool_context,
        notification_ingress,
        live_updates,
    ));

    let dispatcher = PgPollingDispatcher::new(Arc::clone(&repo), dispatcher_executor);
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
    );
    let authorization_state = MacroAuthorizationState::new(Arc::new(authorization_service));

    let state = ScheduledActionRouterState {
        service,
        authorization_state,
    };
    let authed_routes = scheduled_action_router::<_, _, ()>(state);

    let router = Router::new()
        .route("/health", axum::routing::get(health))
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", ApiDoc::openapi()))
        .merge(authed_routes)
        .layer(macro_cors::cors_layer());

    let port = config.port;
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("failed to bind {addr}"))?;

    tracing::info!("scheduled_action service listening on {addr}");

    let server_result = axum::serve(listener, router.into_make_service())
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server closed");

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

/// Waits for Ctrl+C on all platforms or SIGTERM on Unix.
async fn shutdown_signal() {
    let ctrl_c = async {
        match tokio::signal::ctrl_c().await {
            Ok(()) => {}
            Err(error) => {
                tracing::error!(error=?error, "failed to install Ctrl+C handler");
                pending::<()>().await;
            }
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::error!(error=?error, "failed to install SIGTERM handler");
                pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("shutdown signal received");
}
