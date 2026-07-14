#![recursion_limit = "256"]
use std::future::{IntoFuture, pending};
use std::sync::Arc;
use std::time::Duration;

use ai_tools::{ManagedToolServiceContext, build_tool_service_context_from_env};
use anyhow::{Context, Result};
use axum::Router;
use connection_gateway_client::client::ConnectionGatewayClient;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_service_urls::ConnectionGatewayUrl;
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use scheduled_action::config::Config;
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
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

const HTTP_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
#[cfg(test)]
const BROKER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(test)]
const ECS_STOP_TIMEOUT: Duration = Duration::from_secs(10);

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

    let ManagedToolServiceContext {
        tool_context,
        broker_runtime,
    } = build_tool_service_context_from_env(db.clone())
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

    let jwt_args = JwtValidationArgs::new_with_secret_manager(environment, &secretsmanager_client)
        .await
        .context("failed to build jwt validation args")?;

    let port = config.port;
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("failed to bind {addr}"))?;

    let dispatcher = PgPollingDispatcher::new(Arc::clone(&repo), dispatcher_executor);
    let (dispatcher_tx, _execution_rx, dispatcher_runtime) =
        dispatcher.begin_managed_dispatch_loop();

    let service = Arc::new(ScheduledActionServiceImpl::new(
        Arc::clone(&repo),
        service_executor,
        dispatcher_tx,
    ));
    let state = ScheduledActionRouterState { service };
    let authed_routes = scheduled_action_router::<_, ()>(state).layer(
        axum::middleware::from_fn_with_state(jwt_args, macro_middleware::auth::decode_jwt::handler),
    );
    let router = Router::new()
        .route("/health", axum::routing::get(health))
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", ApiDoc::openapi()))
        .merge(authed_routes)
        .layer(macro_cors::cors_layer());

    tracing::info!("scheduled_action service listening on {addr}");

    let server_result = {
        let (shutdown_sender, shutdown_receiver) = tokio::sync::oneshot::channel();
        let server = axum::serve(listener, router.into_make_service())
            .with_graceful_shutdown(async move {
                let _ = shutdown_receiver.await;
            })
            .into_future();
        tokio::pin!(server);

        tokio::select! {
            result = &mut server => result.context("scheduled-action HTTP server failed"),
            signal = shutdown_signal() => {
                tracing::info!(signal, "shutdown signal received; stopping scheduled-action HTTP intake");
                let _ = shutdown_sender.send(());

                match tokio::time::timeout(HTTP_SHUTDOWN_TIMEOUT, &mut server).await {
                    Ok(result) => result.context("scheduled-action HTTP server failed"),
                    Err(_) => {
                        tracing::warn!(
                            timeout_seconds = HTTP_SHUTDOWN_TIMEOUT.as_secs(),
                            "scheduled-action HTTP shutdown timed out; cancelling remaining requests"
                        );
                        Ok(())
                    }
                }
            }
        }
    };

    tracing::info!("scheduled-action HTTP server stopped");
    dispatcher_runtime.shutdown().await;
    broker_runtime.shutdown().await;
    server_result
}

async fn shutdown_signal() -> &'static str {
    let interrupt = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(error=?error, "failed to install SIGINT handler");
            pending::<()>().await;
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
        _ = interrupt => "SIGINT",
        _ = terminate => "SIGTERM",
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn shutdown_budget_fits_ecs_stop_timeout() {
        let planned_shutdown = HTTP_SHUTDOWN_TIMEOUT
            + scheduled_action::outbound::pg_polling_dispatcher::POLLING_DISPATCHER_SHUTDOWN_TIMEOUT
            + BROKER_SHUTDOWN_TIMEOUT;

        assert!(planned_shutdown < ECS_STOP_TIMEOUT);
    }
}
