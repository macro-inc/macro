#![recursion_limit = "256"]
use std::{future::Future, sync::Arc, time::Duration};

use ai_tools::{AiHost, build_tool_service_context_from_env, tools_for};
use anyhow::{Context, Result};
use axum::Router;
use chat::outbound::postgres::PgChatRepo;
use connection_gateway_client::client::ConnectionGatewayClient;
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, PgUserApiKeyAuthorizationRepo, PgUserApiKeyAuthorizer,
};
use macro_entrypoint::MacroEntrypoint;
use macro_service_urls::ConnectionGatewayUrl;
use memory::domain::service::MemoryServiceImpl;
use memory::outbound::pg_memory_repo::PgMemoryRepo;
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use scheduled_action::config::Config;
use scheduled_action::domain::event_runs::{
    PageSize, admission::EventAdmissionService, dispatch::EventDispatchService,
};
use scheduled_action::domain::ports::ScheduledActionDispatcher;
use scheduled_action::domain::service::ScheduledActionServiceImpl;
use scheduled_action::inbound::axum_router::{
    ScheduledActionRouterState, health, scheduled_action_router,
};
use scheduled_action::inbound::event_run_worker::run_event_worker;
use scheduled_action::inbound::kafka_consumer::run_scheduled_action_event_consumer;
use scheduled_action::outbound::conn_gateway_live_updates::ConnGatewayLiveUpdates;
use scheduled_action::outbound::event_access::EventAccessAdapter;
use scheduled_action::outbound::inprocess_executor::{
    InProcessExecutor, agent_task::AgentTaskRunner,
};
use scheduled_action::outbound::pg_event_run_repo::PgEventRunRepo;
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

// ECS stopTimeout is ten seconds. One shared budget includes HTTP, all
// dispatch/execution bookkeeping, and final broker publishes, leaving two seconds.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(8);
const CONSUMER_RESTART_DELAY: Duration = Duration::from_secs(5);
// Keep event agent work well below the shared pool's ten connections, leaving
// headroom for HTTP/cron and tool calls (not a per-tool connection reservation).
const EVENT_CONCURRENCY: u16 = 2;
const ADMISSION_PAGE_SIZE: u16 = 100;
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

    let lifecycle = ServiceLifecycle::default();
    let tool_context = build_tool_service_context_from_env(db.clone(), lifecycle.publishes.clone())
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

    let event_repo = Arc::new(PgEventRunRepo::new(db.clone()));
    let event_access = Arc::new(EventAccessAdapter::new(EntityAccessServiceImpl::new(
        PgAccessRepository::new(db.clone()),
    )));
    let memory = MemoryServiceImpl::new(
        PgMemoryRepo::new(db.clone()),
        tool_context.clone(),
        tools_for(AiHost::Chat),
    );
    let runner = Arc::new(AgentTaskRunner::new(
        Arc::clone(&tool_context.chat_tool_context.service),
        PgChatRepo::new(db.clone()),
        memory,
        tool_context,
        notification_ingress,
    ));
    let dispatcher_executor = InProcessExecutor::new(
        Arc::clone(&repo),
        runner,
        live_updates,
        lifecycle.executions.clone(),
        lifecycle.stop_executions.clone(),
    );
    let service_executor = Arc::new(dispatcher_executor.clone());

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

    // Finish fallible startup before launching intake or claiming any work.
    let addr = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("failed to bind {addr}"))?;

    let dispatcher = PgPollingDispatcher::new(Arc::clone(&repo), dispatcher_executor)
        .with_lifecycle(PgPollingDispatcherLifecycle::new(
            lifecycle.stop_workers.clone(),
            lifecycle.workers.clone(),
        ));
    let (dispatcher_tx, execution_rx) = dispatcher.begin_dispatch_loop();
    // No subscriber consumes these notifications; don't let a full channel
    // eventually block cron dispatch or its shutdown.
    drop(execution_rx);

    let event_dispatch = EventDispatchService::new(
        Arc::clone(&event_repo),
        Arc::clone(&event_access),
        Arc::clone(&service_executor),
    );
    let brokers = config.kafka_brokers.to_string();
    let intake_shutdown = lifecycle.stop_consumers.clone();
    start_event_tasks(
        config.event_routines_enabled,
        &lifecycle,
        move || {
            let admission = EventAdmissionService::new(
                Arc::clone(&event_repo),
                Arc::clone(&event_access),
                PageSize::try_from(ADMISSION_PAGE_SIZE).expect("valid admission bound"),
            );
            let brokers = brokers.clone();
            let shutdown = intake_shutdown.clone();
            async move {
                run_scheduled_action_event_consumer(&brokers, admission, shutdown.cancelled()).await
            }
        },
        run_event_worker(
            event_dispatch,
            lifecycle.stop_workers.clone(),
            lifecycle.executions.clone(),
            PageSize::try_from(EVENT_CONCURRENCY).expect("valid worker bound"),
        ),
    );

    let service = Arc::new(
        ScheduledActionServiceImpl::new(Arc::clone(&repo), service_executor, dispatcher_tx)
            .with_event_management_enabled(config.event_routines_enabled),
    );
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

    tracing::info!(
        event_routines_enabled = config.event_routines_enabled,
        "scheduled_action service listening on {addr}"
    );

    let http_shutdown = lifecycle.stop_http.clone();
    let server = async move {
        axum::serve(listener, router.into_make_service())
            .with_graceful_shutdown(http_shutdown.cancelled_owned())
            .await
            .context("server closed")
    };
    serve_until_shutdown(
        server,
        macro_entrypoint::shutdown_signal(),
        &lifecycle,
        SHUTDOWN_TIMEOUT,
    )
    .await
}

#[derive(Default)]
struct ServiceLifecycle {
    stop_http: CancellationToken,
    stop_consumers: CancellationToken,
    stop_workers: CancellationToken,
    stop_executions: CancellationToken,
    consumers: TaskTracker,
    workers: TaskTracker,
    executions: TaskTracker,
    publishes: TaskTracker,
}

impl ServiceLifecycle {
    fn stop(&self) {
        self.stop_http.cancel();
        self.stop_consumers.cancel();
        self.stop_workers.cancel();
        self.stop_executions.cancel();
        self.consumers.close();
        self.workers.close();
        self.executions.close();
    }

    async fn drain(&self) {
        // Workers may still be completing a committed claim. Wait for them
        // before considering the execution tracker permanently empty.
        tokio::join!(self.consumers.wait(), self.workers.wait());
        self.executions.wait().await;
        self.publishes.close();
        self.publishes.wait().await;
    }
}

fn start_event_tasks<C, F>(
    enabled: bool,
    lifecycle: &ServiceLifecycle,
    consumer: C,
    worker: impl Future<Output = ()> + Send + 'static,
) where
    C: FnMut() -> F + Send + 'static,
    F: Future<Output = Result<(), rootcause::Report>> + Send + 'static,
{
    if !enabled {
        return;
    }
    lifecycle.consumers.spawn(supervise_consumer(
        consumer,
        lifecycle.stop_consumers.clone(),
        CONSUMER_RESTART_DELAY,
    ));
    lifecycle.workers.spawn(worker);
}

async fn supervise_consumer<F: Future<Output = Result<(), rootcause::Report>>>(
    mut consume: impl FnMut() -> F,
    shutdown: CancellationToken,
    restart_delay: Duration,
) {
    loop {
        tokio::select! {
            biased;
            _ = shutdown.cancelled() => return,
            result = consume() => {
                // Do not log admission reports, which can contain event data.
                tracing::warn!(failed = result.is_err(), "event consumer exited; restarting with a fresh consumer");
            }
        }
        // Even an unexpected successful exit must not silently disable intake.
        // A new consumer restores committed offsets; never reuse its position.
        tokio::select! {
            biased;
            _ = shutdown.cancelled() => return,
            _ = tokio::time::sleep(restart_delay) => {},
        }
    }
}

async fn serve_until_shutdown(
    server: impl Future<Output = Result<()>>,
    signal: impl Future<Output = ()>,
    lifecycle: &ServiceLifecycle,
    timeout: Duration,
) -> Result<()> {
    let mut server = std::pin::pin!(server);
    let mut result = tokio::select! {
        result = &mut server => Some(result),
        _ = signal => None,
    };
    lifecycle.stop();
    let drain = async {
        // All cancellation is already signalled, so work drains concurrently.
        // Join HTTP before trusting an empty execution tracker: a request may
        // have passed the executor's shutdown check just before cancellation.
        if result.is_none() {
            result = Some(server.await);
        }
        lifecycle.drain().await;
    };
    if tokio::time::timeout(timeout, drain).await.is_err() {
        tracing::warn!(
            consumers = lifecycle.consumers.len(),
            workers = lifecycle.workers.len(),
            executions = lifecycle.executions.len(),
            publishes = lifecycle.publishes.len(),
            "shutdown deadline reached; unresolved started event runs remain non-retryable"
        );
        // The process exits next. Never turn uncertain started work back into
        // pending work; reconciliation marks it interrupted after claim expiry.
    }
    result.unwrap_or(Ok(()))
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
