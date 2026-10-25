use std::{future::Future, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use axum::Router;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use connection_gateway_client::client::ConnectionGatewayClient;
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use entity_registry::OwnerGrantPolicy;
use entity_registry_db_utils::OwnedEntityRegistrar;
use jev::{domain::JevClassifier, outbound::TypesafeJev};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, PgUserApiKeyAuthorizationRepo, PgUserApiKeyAuthorizer,
};
use macro_service_urls::{ConnectionGatewayUrl, LexicalServiceUrl};
pub mod config;
use config::Config;
use scheduled_action::domain::event_runs::{
    PageSize, admission::EventAdmissionService, condition::ConditionGate,
    dispatch::EventDispatchService,
};
use scheduled_action::domain::ports::ScheduledActionDispatcher;
use scheduled_action::domain::service::ScheduledActionServiceImpl;
use scheduled_action::domain::target_runner::TargetRunner;
use scheduled_action::domain::target_validation::TargetValidation;
use scheduled_action::inbound::axum_router::{ScheduledActionRouterState, scheduled_action_router};
use scheduled_action::inbound::event_run_worker::run_event_worker;
use scheduled_action::inbound::kafka_consumer::run_scheduled_action_event_consumer;
use scheduled_action::outbound::agent_session_client::AgentSessionClient;
use scheduled_action::outbound::conn_gateway_live_updates::ConnGatewayLiveUpdates;
use scheduled_action::outbound::event_access::EventAccessAdapter;
use scheduled_action::outbound::event_content::EventContentAdapter;
use scheduled_action::outbound::inprocess_executor::InProcessExecutor;
use scheduled_action::outbound::pg_event_run_repo::PgEventRunRepo;
use scheduled_action::outbound::pg_polling_dispatcher::{
    PgPollingDispatcher, PgPollingDispatcherLifecycle,
};
use scheduled_action::outbound::pg_scheduled_action_repo::PgScheduledActionRepo;
use scheduled_action::swagger::ApiDoc;
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

#[cfg(test)]
mod test;

// ECS stopTimeout is ten seconds. One shared budget includes HTTP, all
// dispatch/execution bookkeeping, leaving two seconds.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(8);
const CONSUMER_RESTART_DELAY: Duration = Duration::from_secs(5);
// Keep event agent work well below the shared pool's connection limit, leaving
// headroom for HTTP/cron and tool calls (not a per-tool connection reservation).
const EVENT_CONCURRENCY: u16 = 2;
const ADMISSION_PAGE_SIZE: u16 = 100;
const GATEWAY_PATH_PREFIX: &str = "/scheduled-action";

/// Scheduling routes and workers owned by the harness process.
pub struct SchedulingRuntime {
    pub router: Router,
    lifecycle: ServiceLifecycle,
}

impl SchedulingRuntime {
    pub fn stop(&self) {
        self.lifecycle.stop();
    }
    pub async fn shutdown(self) {
        self.lifecycle.stop();
        if tokio::time::timeout(SHUTDOWN_TIMEOUT, self.lifecycle.drain())
            .await
            .is_err()
        {
            tracing::warn!("scheduler shutdown deadline reached");
        }
    }
}

/// Compose routine scheduling and event workers alongside the harness API.
pub async fn build(
    config: Config,
    db: sqlx::PgPool,
    harness_address: std::net::SocketAddr,
    ready: tokio::sync::watch::Receiver<bool>,
) -> Result<SchedulingRuntime> {
    let environment = config.environment;
    let lifecycle = ServiceLifecycle::default();

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

    let registrar = OwnedEntityRegistrar::new(OwnerGrantPolicy::new(PgBotsRepo::new(db.clone())));
    let repo = Arc::new(PgScheduledActionRepo::new(db.clone(), registrar.clone()));

    let event_repo = Arc::new(PgEventRunRepo::new(db.clone()));
    let access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        db.clone(),
    )));
    let event_access = Arc::new(EventAccessAdapter::new(access.as_ref().clone()));
    let ai_admission = ai_billing::composition::pg_admission_service(
        db.clone(),
        config.enable_ai_usage_enforcement,
        config.ai_pricing(),
    );
    let sessions = Arc::new(AgentSessionClient::new(
        &format!("http://{harness_address}"),
        &config.internal_api_key,
    )?);
    let event_content = Arc::new(event_content(
        &db,
        &registrar,
        Arc::clone(&access),
        &config,
    )?);
    let runner = Arc::new(TargetRunner::new(
        Arc::clone(&sessions),
        Arc::clone(&event_content),
    ));
    let dispatcher_executor = InProcessExecutor::new(
        Arc::clone(&repo),
        runner,
        live_updates,
        lifecycle.executions.clone(),
        lifecycle.stop_executions.clone(),
    )
    .with_admission(ai_admission);
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

    let dispatcher = PgPollingDispatcher::new(Arc::clone(&repo), dispatcher_executor)
        .with_lifecycle(
            PgPollingDispatcherLifecycle::new(
                lifecycle.stop_workers.clone(),
                lifecycle.workers.clone(),
            )
            .with_readiness(ready.clone()),
        );
    let (dispatcher_tx, execution_rx) = dispatcher.begin_dispatch_loop();
    // No subscriber consumes these notifications; don't let a full channel
    // eventually block cron dispatch or its shutdown.
    drop(execution_rx);

    let typesafe = config
        .typesafe_api_key
        .value()
        .map(TypesafeJev::new)
        .transpose()
        .context("invalid TYPESAFE_API_KEY")?;
    let conditions_enabled = typesafe.is_some();
    let conditions = match typesafe {
        Some(provider) => Some(ConditionGate::new(
            event_content,
            // Condition evaluation is the only model work this process meters
            // (agent targets are funded by the harness). Counted usage asks the
            // authentication service to settle the payer, as every other host does.
            Arc::new(JevClassifier::new(
                provider,
                ai_billing::composition::pg_settling_recorder(
                    db.clone(),
                    config.enable_ai_usage_enforcement,
                    config.ai_pricing(),
                    config.settlement_route()?,
                ),
            )),
        )),
        None => None,
    };
    let event_dispatch = EventDispatchService::new(
        Arc::clone(&event_repo),
        Arc::clone(&event_access),
        Arc::clone(&service_executor),
    )
    .with_conditions(Arc::new(conditions));
    let brokers = config.kafka_brokers.to_string();
    let intake_shutdown = lifecycle.stop_consumers.clone();
    let mut worker_ready = ready.clone();
    let worker_shutdown = lifecycle.stop_workers.clone();
    let executions = lifecycle.executions.clone();
    start_event_tasks(
        config.event_routines_enabled,
        &lifecycle,
        move || {
            let mut ready = ready.clone();
            let admission = EventAdmissionService::new(
                Arc::clone(&event_repo),
                Arc::clone(&event_access),
                PageSize::try_from(ADMISSION_PAGE_SIZE).expect("valid admission bound"),
            );
            let brokers = brokers.clone();
            let shutdown = intake_shutdown.clone();
            async move {
                tokio::select! {
                    biased;
                    _ = shutdown.cancelled() => return Ok(()),
                    result = ready.wait_for(|ready| *ready) => if result.is_err() { return Ok(()); },
                }
                run_scheduled_action_event_consumer(&brokers, admission, shutdown.cancelled()).await
            }
        },
        async move {
            tokio::select! {
                biased;
                _ = worker_shutdown.cancelled() => return,
                result = worker_ready.wait_for(|ready| *ready) => if result.is_err() { return; },
            }
            run_event_worker(
                event_dispatch,
                worker_shutdown,
                executions,
                PageSize::try_from(EVENT_CONCURRENCY).expect("valid worker bound"),
            )
            .await
        },
    );

    let service = Arc::new(
        ScheduledActionServiceImpl::new(
            Arc::clone(&repo),
            service_executor,
            dispatcher_tx,
            access.clone(),
        )
        .with_event_management_enabled(config.event_routines_enabled)
        .with_conditions_enabled(conditions_enabled)
        .with_target_validation(TargetValidation::new(
            sessions,
            config.routine_agents_enabled,
        )),
    );
    let state = ScheduledActionRouterState {
        service,
        access_service: access,
        authorization_state,
    };
    let authed_routes = scheduled_action_router::<_, _, _, ()>(state);

    let router = mount_router(authed_routes)
        .layer(macro_cors::cors_layer())
        .layer(
            macro_tower_layers::MacroRequestIdAndTracingLayer::new(Duration::from_millis(200))
                .into_inner(),
        );
    Ok(SchedulingRuntime { router, lifecycle })
}

fn mount_router(routes: Router) -> Router {
    Router::new().nest(GATEWAY_PATH_PREFIX, routes).merge(
        SwaggerUi::new("/scheduled-action/docs")
            .url("/scheduled-action/api-doc/openapi.json", ApiDoc::openapi()),
    )
}

/// Read-only views of the domains whose events can trigger a routine, for
/// condition checks and the agent's account of the event. None of these reads
/// notify, publish or enqueue.
fn event_content(
    db: &sqlx::PgPool,
    registrar: &OwnedEntityRegistrar<PgBotsRepo>,
    access: Arc<EntityAccessServiceImpl<PgAccessRepository>>,
    config: &Config,
) -> Result<
    impl scheduled_action::domain::event_runs::condition::EventContentReader
    + scheduled_action::domain::ports::RoutineEventReader
    + use<>,
> {
    Ok(EventContentAdapter::new(
        email::domain::service::EmailServiceImpl::new(
            email::outbound::EmailPgRepo::new(db.clone()),
            frecency::domain::services::FrecencyQueryServiceImpl::new(
                frecency::outbound::postgres::FrecencyPgStorage::new(db.clone()),
            ),
            email::domain::ports::NoOpEnqueuer,
            crm::domain::service::NoOpCrmService,
            entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
                entity_access_management::outbound::PgRepository::new(db.clone()),
            ),
            0,
        ),
        messages::domain::service::MessageService::new(
            messages::outbound::pg_message_repo::PgMessageRepository::new(db.clone()),
            messages::domain::ports::NoMessageEventPublisher,
        ),
        channels::domain::service::ChannelServiceImpl::new(
            channels::outbound::pg_channels_repo::PgChannelsRepo::new(db.clone()),
        ),
        documents::outbound::pg_document_repo::PgDocumentRepo::new(db.clone(), registrar.clone()),
        properties::PropertiesServiceImpl::new(
            properties::PropertiesPgRepo::new(db.clone()),
            Some(properties::PermissionServiceImpl::new(db.clone(), access)),
            None::<NoTaskNotifications>,
        ),
        call::domain::service::CallRecordQueryServiceImpl::new(
            call::outbound::pg_call_repo::PgCallRepo::new(db.clone()),
        ),
        lexical_client::LexicalClient::new(
            config.internal_api_key.to_string(),
            LexicalServiceUrl::new()?.to_string(),
        ),
    ))
}

/// Event content only reads properties; it never assigns tasks.
struct NoTaskNotifications;

impl properties::NotificationService for NoTaskNotifications {
    type Err = anyhow::Error;

    async fn send_task_assigned<'a>(
        &self,
        _: properties::domain::model::TaskAssignedNotification<'a>,
    ) -> Result<(), Self::Err> {
        Ok(())
    }
}

#[derive(Default)]
struct ServiceLifecycle {
    stop_consumers: CancellationToken,
    stop_workers: CancellationToken,
    stop_executions: CancellationToken,
    consumers: TaskTracker,
    workers: TaskTracker,
    executions: TaskTracker,
}

impl ServiceLifecycle {
    fn stop(&self) {
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
