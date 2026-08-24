//! Composition root for the agent harness service.
//!
//! The hexagon lives in `crates/agent_harness`; this binary is the shell
//! around it: it builds the Postgres repositories, the container
//! manager (Daytona, or local Docker when opted in), and a channel service with the full side-effect stack for
//! announcements, derives agent triggers from `macro.channels`, then drives
//! the orchestrator from the resulting `macro.agent_sessions` events.

mod api;
mod bots_directory;
mod config;
mod trigger;

use std::sync::Arc;

use agent_fold::domain::service::FoldedMessageService;
use agent_harness::domain::model::SessionDefaults;
use agent_harness::domain::service::AgentHarnessService;
use agent_harness::inbound::kafka::{RoutedTrigger, route_agent_trigger};
use agent_harness::inbound::runtime_gateway::RuntimeGatewayState;
use agent_harness::outbound::channel_announcer::ChannelAnnouncer;
use agent_harness::outbound::containers::HarnessContainers;
use agent_harness::outbound::daytona::{
    DaytonaApiKey as DaytonaApiKeySecret, DaytonaContainerManager, DaytonaSettings,
    GithubToken as GithubTokenSecret, Snapshot,
};
use agent_harness::outbound::local::{LocalContainerManager, LocalSettings};
use agent_harness::outbound::runtime_registry::RuntimeRegistry;
use agent_session::domain::service::AgentSessionServiceImpl;
use agent_session::inbound::axum_router::{
    AgentSessionControlState, AgentSessionRouterState, CreateSessionState,
};
use agent_session::outbound::connection_gateway_realtime::ConnectionGatewayAgentSessionRealtime;
use agent_session::outbound::name_generator::HaikuAgentSessionNameGenerator;
use agent_session::outbound::postgres::PgAgentSessionRepo;
use agent_trigger::domain::broker_events::AgentSessionMacroEvent;
use anyhow::Context as _;
use bot_id::BotId;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use bots_directory::PgBotDirectory;
use channels::domain::service::ChannelServiceImpl;
use channels::domain::side_effects::{ChannelSideEffectService, SpawnedChannelEventDispatcher};
use channels::outbound::connection_gateway_realtime::ConnectionGatewayChannelRealtimePublisher;
use channels::outbound::contacts_dispatcher::ContactsChannelDispatcher;
use channels::outbound::notification_sender::NotificationChannelSender;
use channels::outbound::pg_channels_repo::PgChannelsRepo;
use channels::outbound::pg_side_effect_context::PgChannelSideEffectContext;
use config::{Config, Environment};
use connection_gateway_client::ConnectionGatewayClient;
use kafka_util::{GroupName, KafkaEventConsumer};
use lexical_client::LexicalClient;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, PgBotAuthorizationRepo, PgBotAuthorizer,
};
use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use macro_event_broker::{
    KafkaConsumerAdapter, KafkaEventPublisher, MacroEvent as _, MacroEventBrokerService,
    MacroEventCollection as _, MacroEventConsumerService,
};
use macro_service_urls::{ConnectionGatewayUrl, LexicalServiceUrl};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use sqlx::postgres::PgPoolOptions;

/// Consumer group owning this harness's agent-session offsets.
///
/// TODO: one group per bot deployment. Two bots sharing this name would
/// split partitions between them and each miss half its events; fine while
/// exactly one harness deployment exists.
struct AgentHarnessConsumerGroup;

impl GroupName for AgentHarnessConsumerGroup {
    const GROUP_NAME: &'static str = "agent-harness-service";
}

macro_event_broker::declare_topics!(DeclaredMacroEvent: AgentSessionMacroEvent);

type HarnessKafkaAdapter = KafkaConsumerAdapter<AgentHarnessConsumerGroup, DeclaredMacroEvent>;
type HarnessConsumer = MacroEventConsumerService<DeclaredMacroEvent, HarnessKafkaAdapter>;

fn commit_message(consumer: &HarnessConsumer, message: &BorrowedMessage<'_>) -> anyhow::Result<()> {
    consumer
        .inner()
        .commit_message(message, CommitMode::Sync)
        .map_err(|error| anyhow::anyhow!("failed to commit agent session offset: {error:?}"))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    agent_harness::install_tls_provider();
    let config = Config::from_env()?;
    let bot_id = BotId::new_from_uuid(config.harness_bot_id);

    let pool = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(5)
        .connect(config.database_url.as_ref())
        .await
        .context("failed to connect to macrodb")?;

    // Built before the sessions rather than beside the other channel plumbing
    // below: this service owns the live actors, so it is where a session's
    // frames are streamed from.
    let connection_gateway = Arc::new(ConnectionGatewayClient::new(
        config.internal_api_key.clone(),
        ConnectionGatewayUrl::new()?.to_string(),
    ));

    // Sessions: persistence and live actors. The same repo answers every port,
    // as in the `document_storage_service` root - a session's actor writes its
    // log and pushes each frame at the channel's participants so a viewer sees
    // it happen.
    let session_repo = PgAgentSessionRepo::new(pool.clone());
    let sessions = AgentSessionServiceImpl::new(
        session_repo.clone(),
        FoldedMessageService::new(session_repo.clone()),
        ConnectionGatewayAgentSessionRealtime::new(
            connection_gateway.clone(),
            session_repo.clone(),
        ),
    )
    .with_name_generator(HaikuAgentSessionNameGenerator::new(ai_usage::pg_recorder(
        pool.clone(),
    )));

    // Containers: local Docker when a developer has opted in, Daytona otherwise.
    let containers = if config.dev_dangerous_local_containers {
        if !matches!(config.environment, Environment::Local) {
            anyhow::bail!("DEV_DANGEROUS_LOCAL_CONTAINERS is only allowed when ENVIRONMENT=local");
        }
        if config.github_token.trim().is_empty() {
            tracing::warn!(
                "GITHUB_TOKEN is unset: local sandboxes cannot clone private repositories; external agent sessions are unaffected"
            );
        }
        let network = config.local_container_network.trim();
        if network.is_empty() {
            anyhow::bail!(
                "LOCAL_CONTAINER_NETWORK is required when DEV_DANGEROUS_LOCAL_CONTAINERS is set"
            );
        }
        HarnessContainers::Local(LocalContainerManager::new(LocalSettings {
            docker_binary: config.local_container_docker_binary.clone(),
            image: config.local_container_image.clone(),
            network: network.to_owned(),
            github_token: GithubTokenSecret::new(config.github_token.clone()),
        }))
    } else {
        // Credential-less boot is deliberate: external sessions need neither.
        // A managed spawn without them fails at spawn time instead, loudly.
        if config.daytona_api_key.trim().is_empty() || config.github_token.trim().is_empty() {
            tracing::warn!(
                "DAYTONA_API_KEY and/or GITHUB_TOKEN are unset: managed sandboxes are unarmed; external agent sessions are unaffected"
            );
        }
        HarnessContainers::Daytona(DaytonaContainerManager::new(DaytonaSettings {
            api_url: config.daytona_api_url.clone(),
            api_key: DaytonaApiKeySecret::new(config.daytona_api_key.clone()),
            snapshot: Snapshot::new(config.daytona_snapshot.clone()),
            github_token: GithubTokenSecret::new(config.github_token.clone()),
        }))
    };
    let container_shutdown = containers.clone();

    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let notifications = Arc::new(notification::domain::service::SqsNotificationIngress {
        queue: notification::outbound::queue::SqsQueue::new(
            aws_sdk_sqs::Client::new(&aws_config),
            macro_queues::NotificationIngressQueue::new().to_string(),
        ),
    });
    let contacts_ingress = Arc::new(contacts::domain::service::SqsContactsIngress {
        queue: contacts::outbound::ingress::SqsContactsQueue::new(
            aws_sdk_sqs::Client::new(&aws_config),
            macro_queues::ContactsQueue::new().to_string(),
        ),
    });
    let broker = MacroEventBrokerService::new(
        KafkaEventPublisher::new(config.kafka_brokers.as_ref())
            .context("failed to create kafka event publisher")?,
        macro_event_broker::GlobalSpawner,
    );
    let side_effects = ChannelSideEffectService::new(
        PgChannelSideEffectContext::new(pool.clone()),
        ConnectionGatewayChannelRealtimePublisher::new(connection_gateway.clone()),
        NotificationChannelSender::new(notifications),
        ContactsChannelDispatcher::new(contacts_ingress),
    )
    .with_macro_event_broker(broker);
    let channel_service = Arc::new(ChannelServiceImpl::with_dependencies(
        PgChannelsRepo::new(pool.clone()),
        SpawnedChannelEventDispatcher::new(side_effects),
        channels::domain::service::NoopChannelReferenceSharePermissions,
    ));
    let announcer = ChannelAnnouncer::new(
        channel_service,
        LexicalClient::new(
            config.internal_api_key.clone(),
            LexicalServiceUrl::new()?.to_string(),
        ),
    );

    // One connection per bot, shared by every session that bot runs. Held
    // here because the gateway puts dialed-in sockets into it and the harness
    // takes sessions out of it.
    let runtimes = RuntimeRegistry::new();
    let harness = Arc::new(AgentHarnessService::new(
        sessions,
        containers,
        announcer,
        Arc::clone(&runtimes),
        SessionDefaults {
            bot_id,
            model: config.harness_model.clone(),
            harness: config.harness_slug.clone(),
            repo_url: config.harness_repo_url.clone(),
        },
    ));

    // The complete session API is served from this process because it owns the
    // live sessions. Spawned rather than awaited: the Kafka loop below owns the
    // main task, and both run until shutdown.
    let authorization_service = MacroAuthorizationServiceImpl::new(
        MacroAuthJwtValidator::new(
            JwtValidationArgs::new_with_secret_manager(
                config.environment,
                &secretsmanager_client::SecretsManager::new(aws_sdk_secretsmanager::Client::new(
                    &aws_config,
                )),
            )
            .await?,
        ),
        InternalAuthConfig {
            api_key: config.internal_api_key.clone(),
            default_user_id: None,
        },
        PgBotAuthorizer::new(PgBotAuthorizationRepo::new(pool.clone())),
    );
    let entity_access = Arc::new(
        entity_access::domain::service::EntityAccessServiceImpl::new(
            entity_access::outbound::PgAccessRepository::new(pool.clone()),
        ),
    );
    let read_state = AgentSessionRouterState::new(
        AgentSessionServiceImpl::new(
            session_repo.clone(),
            FoldedMessageService::new(session_repo.clone()),
            ConnectionGatewayAgentSessionRealtime::new(connection_gateway, session_repo.clone()),
        ),
        entity_access.clone(),
        MacroAuthorizationState::new(Arc::new(authorization_service.clone())),
    );
    let control_state = AgentSessionControlState::new(
        harness.clone(),
        entity_access,
        MacroAuthorizationState::new(Arc::new(authorization_service.clone())),
    );
    let bots_directory = Arc::new(PgBotDirectory::new(PgBotsRepo::new(pool.clone())));
    let create_state = CreateSessionState::new(
        harness.clone(),
        bots_directory.clone(),
        MacroAuthorizationState::new(Arc::new(authorization_service.clone())),
    );
    let gateway_state = RuntimeGatewayState::new(
        runtimes,
        bots_directory,
        MacroAuthorizationState::new(Arc::new(authorization_service)),
    );
    let http_port = config.port;
    let http = tokio::spawn(async move {
        if let Err(error) = api::setup_and_serve(
            read_state,
            control_state,
            create_state,
            gateway_state,
            http_port,
            shutdown_signal(),
        )
        .await
        {
            tracing::error!(error = ?error, "agent harness service http stopped");
        }
    });

    // Keep trigger generation in this deployment while retaining Kafka as the
    // boundary between channel events and harness commands.
    let mut trigger = tokio::spawn(trigger::supervise(
        pool.clone(),
        config.kafka_brokers.as_ref().to_owned(),
    ));

    // The consumer: every agent-session event, filtered to our bot.
    let consumer =
        KafkaEventConsumer::<AgentHarnessConsumerGroup>::from_env(config.kafka_brokers.as_ref())?;
    let consumer = KafkaConsumerAdapter::<AgentHarnessConsumerGroup, ()>::new(consumer)
        .subscribe::<DeclaredMacroEvent>()
        .map_err(|error| {
            anyhow::anyhow!("failed to subscribe to agent session events: {error:?}")
        })?;
    let consumer = HarnessConsumer::new(consumer);

    tracing::info!(
        topics = ?DeclaredMacroEvent::topics(),
        group = AgentHarnessConsumerGroup::GROUP_NAME,
        %bot_id,
        environment = %config.environment,
        "agent harness service listening"
    );

    let mut shutdown = std::pin::pin!(shutdown_signal());
    let mut tasks = tokio::task::JoinSet::new();
    let mut run_error = None;
    loop {
        tokio::select! {
            () = &mut shutdown => {
                tracing::info!("agent harness service shutting down");
                break;
            }
            result = &mut trigger => {
                run_error = Some(match result {
                    Ok(()) => anyhow::anyhow!("agent trigger stopped unexpectedly"),
                    Err(error) => anyhow::anyhow!("agent trigger task failed: {error}"),
                });
                break;
            }
            result = consumer.recv() => {
                let message = match result {
                    Ok(message) => message,
                    Err(error) => {
                        tracing::error!(error = ?error, "failed to receive agent session event");
                        continue;
                    }
                };
                let kafka_message = message.inner();
                let event = match message.decode_payload() {
                    Ok(DeclaredMacroEvent::AgentSessionMacroEvent(event)) => event,
                    Err(error) => {
                        tracing::error!(
                            error = ?error,
                            partition = kafka_message.partition(),
                            offset = kafka_message.offset(),
                            "dropping undecodable agent session event"
                        );
                        match commit_message(&consumer, kafka_message) {
                            Ok(()) => continue,
                            Err(error) => {
                                run_error = Some(error);
                                break;
                            }
                        }
                    }
                };

                let routed = match route_agent_trigger(event.event().event.clone(), bot_id) {
                    Ok(routed) => routed,
                    Err(skipped) => {
                        tracing::debug!(?skipped, "skipped an agent session event");
                        match commit_message(&consumer, kafka_message) {
                            Ok(()) => continue,
                            Err(error) => {
                                run_error = Some(error);
                                break;
                            }
                        }
                    }
                };

                // Intentionally at-most-once: keep ingestion simple and never
                // let concurrent task completion commit Kafka offsets out of order.
                if let Err(error) = commit_message(&consumer, kafka_message) {
                    run_error = Some(error);
                    break;
                }
                match routed {
                    RoutedTrigger::Command(session_id, command) => {
                        let execution = harness.execute(session_id, command);
                        tasks.spawn(async move {
                            match execution.await {
                                Ok(()) => tracing::info!(%session_id, "executed an agent harness command"),
                                Err(error) => {
                                    tracing::error!(error = ?error, %session_id, "failed to execute an agent harness command");
                                }
                            }
                        });
                    }
                    RoutedTrigger::Announce(session_id, prompt) => {
                        let harness = harness.clone();
                        tasks.spawn(async move {
                            match harness.announce_external_prompt(session_id, prompt).await {
                                Ok(()) => tracing::info!(%session_id, "announced an external prompt"),
                                Err(error) => {
                                    tracing::error!(error = ?error, %session_id, "failed to announce an external prompt");
                                }
                            }
                        });
                    }
                }
            }
            Some(result) = tasks.join_next(), if !tasks.is_empty() => {
                if let Err(error) = result {
                    tracing::error!(error = ?error, "agent harness task failed");
                }
            }
        }
    }

    http.abort();
    trigger.abort();
    container_shutdown.shutdown_all().await;

    while let Some(result) = tasks.join_next().await {
        if let Err(error) = result {
            tracing::error!(error = ?error, "agent harness task failed during shutdown");
        }
    }

    let stop_failures = container_shutdown.shutdown_all().await;
    if stop_failures > 0 {
        tracing::error!(stop_failures, "some sandboxes failed to stop");
    }

    match run_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}
