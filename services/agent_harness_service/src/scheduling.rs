use std::{future::Future, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use axum::Router;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use connection_gateway_client::client::ConnectionGatewayClient;
use email_service_client::EmailServiceClient;
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use entity_registry::OwnerGrantPolicy;
use entity_registry_db_utils::OwnedEntityRegistrar;
use github::outbound::pg_installation_claims::PgGithubInstallationClaims;
use jev::{domain::JevClassifier, outbound::SystemOneJev};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, PgUserApiKeyAuthorizationRepo, PgUserApiKeyAuthorizer,
};
use macro_service_urls::{ConnectionGatewayUrl, EmailServiceUrl, LexicalServiceUrl};
pub mod config;
mod routine_analytics;
mod routine_run_notifications;
pub mod routine_suggestions;
use config::Config;
use ideas::domain::service::IdeaService;
use ideas::inbound::router::{IdeaRouterState, idea_router};
use ideas::outbound::idea_access::EntityIdeaAccess;
use ideas::outbound::pg_idea_repo::PgIdeaRepo;
use scheduled_action::domain::code_upgrade;
use scheduled_action::domain::drafts::{DraftAgent, RoutineDrafts};
use scheduled_action::domain::event_runs::{
    PageSize, admission::EventAdmissionService, condition::ConditionGate,
    dispatch::EventDispatchService,
};
use scheduled_action::domain::models::CreatedItem;
use scheduled_action::domain::ports::{
    DraftHandBacks, RequestSessions, ScheduledActionDispatcher, SessionCreations,
};
use scheduled_action::domain::program_runner::ProgramRunner;
use scheduled_action::domain::service::ScheduledActionServiceImpl;
use scheduled_action::domain::suggestions::{
    RoutineBriefing, RoutineSuggestionService, StoredSuggestionOrigins,
};
use scheduled_action::domain::target_runner::TargetRunner;
use scheduled_action::domain::target_validation::TargetValidation;
use scheduled_action::domain::templates::RoutineTemplateServiceImpl;
use scheduled_action::inbound::axum_router::{ScheduledActionRouterState, scheduled_action_router};
use scheduled_action::inbound::draft_router::{RoutineDraftRouterState, routine_draft_router};
use scheduled_action::inbound::event_run_worker::run_event_worker;
use scheduled_action::inbound::kafka_consumer::run_scheduled_action_event_consumer;
use scheduled_action::inbound::suggestion_router::{
    RoutineSuggestionRouterState, routine_suggestion_router,
};
use scheduled_action::inbound::template_router::{
    RoutineTemplateRouterState, routine_template_router,
};
use scheduled_action::outbound::agent_session_client::AgentSessionClient;
use scheduled_action::outbound::conn_gateway_live_updates::ConnGatewayLiveUpdates;
use scheduled_action::outbound::event_access::EventAccessAdapter;
use scheduled_action::outbound::event_content::EventContentAdapter;
use scheduled_action::outbound::inprocess_executor::InProcessExecutor;
use scheduled_action::outbound::pg_code_upgrades::PgCodeUpgrades;
use scheduled_action::outbound::pg_draft_hand_backs::PgDraftHandBacks;
use scheduled_action::outbound::pg_event_run_repo::PgEventRunRepo;
use scheduled_action::outbound::pg_polling_dispatcher::{
    PgPollingDispatcher, PgPollingDispatcherLifecycle,
};
use scheduled_action::outbound::pg_routine_template_repo::PgRoutineTemplateRepo;
use scheduled_action::outbound::pg_scheduled_action_repo::PgScheduledActionRepo;
use scheduled_action::outbound::pg_suggestion_repo::PgSuggestionRepo;
use scheduled_action::swagger::ApiDoc;
use suggestion_generation::domain::model::GenerationAgent;
use suggestion_generation::domain::service::GenerationService;
use suggestion_generation::inbound::router::{GenerationRouterState, generation_router};
use suggestion_generation::outbound::pg_generation_repo::PgGenerationRepo;
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
/// How often drafts a stopped process left behind are cleaned up.
const DRAFT_SWEEP_INTERVAL: Duration = Duration::from_secs(60);
/// How often generation sessions a stopped process left behind are cleaned up.
const GENERATION_SWEEP_INTERVAL: Duration = Duration::from_secs(60);
/// How often people in their night are checked for a nightly generation.
const NIGHTLY_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// What a session's programs created, from the activity recorded for its
/// code-mode invocations.
struct ActivityCreations(activity::outbound::pg_activity_repo::PgActivityRepo);

/// Activity rows read per draft; a draft creates a handful of items.
const DRAFT_ACTIVITY_PAGE: u32 = 100;

#[async_trait::async_trait]
impl SessionCreations for ActivityCreations {
    async fn created_by(&self, session: uuid::Uuid) -> Result<Vec<CreatedItem>> {
        use activity::domain::models::{Action, RecordedAction};
        use activity::domain::ports::AgentActivityReads as _;
        let page = self
            .0
            .agent_activity(
                session,
                None,
                None,
                std::num::NonZeroU32::new(DRAFT_ACTIVITY_PAGE).context("page size")?,
            )
            .await
            .map_err(|error| anyhow::anyhow!("could not read a session's activity: {error}"))?;
        Ok(page
            .records
            .into_iter()
            .filter(|record| matches!(record.action, RecordedAction::Known(Action::Created)))
            .map(|record| CreatedItem {
                entity_type: record.entity_type,
                entity_id: record.entity_id,
            })
            .collect())
    }
}

/// The agent session behind a code-mode request, from the invocation its
/// credential names.
struct CorrelationSessions(agent_correlation::outbound::PgCorrelationRepository);

#[async_trait::async_trait]
impl RequestSessions for CorrelationSessions {
    async fn session_of(&self, correlation: uuid::Uuid) -> Result<Option<uuid::Uuid>> {
        use agent_correlation::domain::CorrelationRepository as _;
        Ok(self
            .0
            .find(correlation)
            .await
            .map_err(|error| anyhow::anyhow!("could not read a code-mode invocation: {error}"))?
            .map(|correlation| correlation.session_id))
    }
}

/// Paid plans, as AI billing sees them: a paid seat or an enterprise team.
struct EntitlementPlans(ai_billing::composition::PgEntitlementSource);

#[async_trait::async_trait]
impl suggestion_generation::domain::ports::Plans for EntitlementPlans {
    async fn paid(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> Result<bool, rootcause::Report> {
        use ai_billing::domain::EntitlementSource as _;
        let entitlement = self
            .0
            .entitlement(user)
            .await
            .map_err(|error| rootcause::report!("{error:?}"))?;
        Ok(entitlement.unlimited || entitlement.tier.is_paid())
    }
}

#[async_trait::async_trait]
impl ideas::domain::ports::RequestSessions for CorrelationSessions {
    async fn session_of(
        &self,
        correlation: uuid::Uuid,
    ) -> Result<Option<uuid::Uuid>, rootcause::Report> {
        RequestSessions::session_of(self, correlation)
            .await
            .map_err(|error| rootcause::report!("{error:?}"))
    }
}

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
pub async fn build<Ingress: notification::domain::service::NotificationIngress>(
    config: Config,
    db: sqlx::PgPool,
    harness_address: std::net::SocketAddr,
    code: Option<crate::routine_code::SdkRoutineCode>,
    ready: tokio::sync::watch::Receiver<bool>,
    notifications: Arc<Ingress>,
) -> Result<SchedulingRuntime> {
    let environment = config.environment;
    let lifecycle = ServiceLifecycle::default();
    let generation_ready = ready.clone();

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
    let event_access = Arc::new(EventAccessAdapter::new(
        access.as_ref().clone(),
        PgGithubInstallationClaims::new(db.clone()),
    ));
    let ai_admission = ai_billing::composition::pg_admission_service(
        db.clone(),
        config.enable_ai_usage_enforcement,
        config.ai_pricing(),
    );
    let sessions = Arc::new(AgentSessionClient::new(
        &format!("http://{harness_address}"),
        &config.internal_api_key,
    )?);
    // Conditions and decisions share one classifier, the only model work this
    // process meters (agent targets are funded by the harness); both are off
    // without a TypeSafe key. Counted usage asks the authentication service to
    // settle the payer, as every other host does.
    let typesafe = config
        .typesafe_api_key
        .value()
        .map(SystemOneJev::typesafe)
        .transpose()
        .context("invalid TYPESAFE_API_KEY")?;
    let conditions_enabled = typesafe.is_some();
    let classifier = typesafe
        .map(|provider| -> Result<_> {
            Ok(Arc::new(JevClassifier::new(
                provider,
                ai_billing::composition::pg_settling_recorder(
                    db.clone(),
                    config.enable_ai_usage_enforcement,
                    config.ai_pricing(),
                    config.settlement_route()?,
                ),
            )))
        })
        .transpose()?;
    // Trigger content is read for templates and the agent's account of the
    // event whether or not there is a classifier.
    let event_content = Arc::new(event_content(
        &db,
        &registrar,
        Arc::clone(&access),
        &config,
    )?);
    // Tool and code steps run in this process, as the owner; agent steps
    // still go through the routine-session operations.
    let code = Arc::new(code);
    let upgrades = Arc::new(PgCodeUpgrades::new(db.clone()));
    // After a release, bring routines' code to the new SDK before their runs
    // need it; a run still upgrades its own code if this hasn't reached it.
    {
        let (code, upgrades, repo) = (Arc::clone(&code), Arc::clone(&upgrades), Arc::clone(&repo));
        let stop = lifecycle.stop_workers.clone();
        let mut ready = ready.clone();
        lifecycle.workers.spawn(async move {
            tokio::select! {
                biased;
                _ = stop.cancelled() => return,
                result = ready.wait_for(|ready| *ready) => if result.is_err() { return; },
            }
            if let Err(error) =
                code_upgrade::sweep(code.as_ref(), upgrades.as_ref(), repo.as_ref(), &stop).await
            {
                tracing::warn!(error = ?error, "routine code sweep stopped");
            }
        });
    }
    let runner = Arc::new(
        ProgramRunner::new(
            Arc::new(TargetRunner::new(Arc::clone(&sessions))),
            Arc::clone(&event_content),
        )
        .with_code(Arc::clone(&code), Arc::clone(&upgrades)),
    );
    let dispatcher_executor = InProcessExecutor::new(
        Arc::clone(&repo),
        runner,
        live_updates,
        lifecycle.executions.clone(),
        lifecycle.stop_executions.clone(),
    )
    .with_admission(Arc::clone(&ai_admission))
    .with_observer(Arc::new((
        routine_analytics::RoutineAnalytics(
            agent_harness_service::product_analytics::ProductAnalytics::new(
                config.posthog_api_key.value(),
                config.posthog_host.value(),
                environment,
                &db,
            ),
        ),
        routine_run_notifications::RoutineRunNotifications::new(
            notifications,
            lifecycle.executions.clone(),
        ),
    )));
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

    let conditions = classifier.map(|classifier| ConditionGate::new(event_content, classifier));
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

    // AI drafts routines in hidden sessions of the in-process Macro agent on
    // the model the person's Ask AI steps use, admitted and billed as their
    // agent session usage. A draft's session hands its routine back by checking
    // it; the check is kept on the draft's row, so any replica can read it.
    let hand_backs: Arc<dyn DraftHandBacks> = Arc::new(PgDraftHandBacks::new(db.clone()));
    let drafts = Arc::new(
        RoutineDrafts::new(
            Arc::clone(&code),
            Arc::clone(&sessions),
            Arc::clone(&hand_backs),
            DraftAgent {
                bot: bot_id::MACRO_NEW_BOT_ID,
                // Generated from the SDK at build time, so it is always there.
                guide: agent_code_mode::domain::entity_guide("routines").unwrap_or_default(),
            },
        )
        .with_session_creations(Arc::new(ActivityCreations(
            activity::outbound::pg_activity_repo::PgActivityRepo::new(db.clone()),
        )))
        .with_conditions_enabled(conditions_enabled),
    );
    // Drafts a stopped process left behind lose their session and row.
    {
        let drafts = Arc::clone(&drafts);
        let stop = lifecycle.stop_workers.clone();
        lifecycle.workers.spawn(async move {
            let mut every = tokio::time::interval(DRAFT_SWEEP_INTERVAL);
            loop {
                tokio::select! {
                    biased;
                    _ = stop.cancelled() => return,
                    _ = every.tick() => {}
                }
                // Logged by the sweep's span.
                let _ = drafts.sweep().await;
            }
        });
    }
    let suggestion_code = Arc::clone(&code);
    // Which agent session a code-mode request came from, for drafts' checks
    // and suggestion sessions' suggestions.
    let correlation_sessions = Arc::new(CorrelationSessions(
        agent_correlation::outbound::PgCorrelationRepository(db.clone()),
    ));
    let request_sessions: Arc<dyn RequestSessions> = correlation_sessions.clone();
    let suggestion_repo = Arc::new(PgSuggestionRepo::new(db.clone()));
    let service = Arc::new(
        ScheduledActionServiceImpl::new(
            Arc::clone(&repo),
            service_executor,
            dispatcher_tx,
            access.clone(),
        )
        .with_event_management_enabled(config.event_routines_enabled)
        .with_conditions_enabled(conditions_enabled)
        .with_target_validation(TargetValidation::new(Arc::clone(&sessions)))
        .with_draft_hand_backs(hand_backs, Arc::clone(&request_sessions))
        .with_suggestion_origins(Arc::new(StoredSuggestionOrigins(Arc::clone(
            &suggestion_repo,
        ))))
        .with_github_links(PgGithubInstallationClaims::new(db.clone()))
        .with_code(code, upgrades),
    );
    let template_flags = config
        .posthog_api_key
        .value()
        .map(|key| {
            feature_flags::outbound::posthog::PostHogFeatureFlags::new(
                config
                    .posthog_host
                    .value()
                    .unwrap_or("https://us.i.posthog.com"),
                key.to_owned(),
                Duration::from_secs(3),
            )
        })
        .transpose()
        .map_err(|error| anyhow::anyhow!("invalid routine feature flag configuration: {error}"))?;
    // Generations: hidden sessions of the in-process Macro agent on the free
    // tier's model, at onboarding and in each person's night, opened
    // non-billable (`SessionBilling::NonBillable`), so their usage is
    // recorded, never billed. Ideas sessions write through `macro.ideas.*`;
    // routines sessions through `macro.routines.suggest`, reading the newest
    // mail through email_service, which reads it from the provider.
    let generations = Arc::new(PgGenerationRepo::new(db.clone()));
    let suggestions = Arc::new(RoutineSuggestionService::new(
        Arc::clone(&service),
        suggestion_repo,
        Arc::new(routine_suggestions::HarnessSuggestionSources {
            email: Arc::new(EmailServiceClient::new(
                config.internal_api_key.to_string(),
                EmailServiceUrl::new()?.to_string(),
            )),
            apps: crate::routine_sessions::PipedreamConnectedApps(
                pipedream_mcp::outbound::pg_connection_repo::PgConnectionRepo::new(db.clone()),
            ),
        }),
        suggestion_code,
        request_sessions,
        generations.clone(),
        generations.clone(),
        template_flags.clone(),
        RoutineBriefing {
            guide: agent_code_mode::domain::entity_guide("routines").unwrap_or_default(),
            agent_model: chat::domain::models::FREE_MODEL.to_owned(),
        },
    ));
    let ideas = Arc::new(
        IdeaService::new(
            Arc::new(PgIdeaRepo::new(db.clone())),
            Arc::new(EntityIdeaAccess(access.as_ref().clone())),
            correlation_sessions,
            generations.clone(),
            generations.clone(),
            template_flags.clone(),
        )
        .with_sdk_reference(agent_code_mode::domain::index_digest(
            ideas::domain::prompt::SYMBOLS,
            ideas::domain::prompt::FIELDS_OF,
        )),
    );
    let generation = Arc::new(
        GenerationService::new(
            generations,
            sessions,
            Arc::clone(&suggestions),
            Arc::clone(&ideas),
            template_flags.clone(),
            GenerationAgent {
                bot: bot_id::MACRO_NEW_BOT_ID,
                model: chat::domain::models::FREE_MODEL.to_owned(),
            },
            lifecycle.workers.clone(),
            lifecycle.stop_workers.clone(),
        )
        // Nightly runs are for paid plans; onboarding runs for everyone.
        .with_plans(Arc::new(EntitlementPlans(
            ai_billing::composition::pg_entitlement_source(db.clone()),
        ))),
    );
    // Generation sessions a stopped process left behind lose their session;
    // once ready, people in their night get their nightly generation.
    {
        let generation = Arc::clone(&generation);
        let stop = lifecycle.stop_workers.clone();
        let mut ready = generation_ready;
        lifecycle.workers.spawn(async move {
            tokio::select! {
                biased;
                _ = stop.cancelled() => return,
                result = ready.wait_for(|ready| *ready) => if result.is_err() { return; },
            }
            let mut sweep = tokio::time::interval(GENERATION_SWEEP_INTERVAL);
            sweep.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            let mut nightly = tokio::time::interval(NIGHTLY_INTERVAL);
            nightly.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                // Each is logged by its own span.
                tokio::select! {
                    biased;
                    _ = stop.cancelled() => return,
                    _ = sweep.tick() => { let _ = generation.sweep().await; }
                    _ = nightly.tick() => { let _ = generation.nightly().await; }
                }
            }
        });
    }
    let suggestion_state = RoutineSuggestionRouterState {
        service: suggestions,
        authorization_state: authorization_state.clone(),
    };
    // Ideas: written and managed by generation sessions through
    // `macro.ideas.*`, read and acted on by the person. Served here, under
    // the scheduler's prefix, next to the routine suggestions they share
    // generations with.
    let idea_state = IdeaRouterState {
        service: ideas,
        authorization_state: authorization_state.clone(),
    };
    let generation_state = GenerationRouterState {
        service: generation,
        authorization_state: authorization_state.clone(),
    };
    let template_state = RoutineTemplateRouterState {
        service: Arc::new(RoutineTemplateServiceImpl::new(
            Arc::clone(&service),
            Arc::new(PgRoutineTemplateRepo::new(db.clone())),
            template_flags,
        )),
        access_service: Arc::clone(&access),
        authorization_state: authorization_state.clone(),
    };
    let draft_state = RoutineDraftRouterState {
        service: drafts,
        authorization_state: authorization_state.clone(),
    };
    let state = ScheduledActionRouterState {
        service,
        access_service: access,
        authorization_state,
    };
    let authed_routes = scheduled_action_router::<_, _, _, ()>(state)
        .merge(routine_template_router::<_, _, _, ()>(template_state))
        .merge(routine_draft_router::<_, _, ()>(draft_state))
        .merge(routine_suggestion_router::<_, _, ()>(suggestion_state))
        .merge(idea_router::<_, _, ()>(idea_state))
        .merge(generation_router::<_, _, ()>(generation_state));

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
            .url("/scheduled-action/api-doc/openapi.json", openapi()),
    )
}

/// The scheduler's OpenAPI, with the ideas routes it also serves, as
/// `scheduling_openapi` prints it.
fn openapi() -> utoipa::openapi::OpenApi {
    let mut openapi = ApiDoc::openapi();
    openapi.merge(ideas::swagger::IdeasApiDoc::openapi());
    openapi.merge(suggestion_generation::swagger::GenerationApiDoc::openapi());
    openapi
}

/// Read-only views of the domains whose events can trigger a routine, for
/// trigger conditions, code and the agent's account of the event. None of
/// these reads notify, publish or enqueue; routine writes go through code
/// steps' SDK calls or the agent.
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
