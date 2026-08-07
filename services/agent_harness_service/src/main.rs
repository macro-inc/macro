//! Composition root for the agent harness service.
//!
//! The hexagon lives in `crates/agent_harness`; this binary is the shell
//! around it: it builds the Postgres repositories, the Daytona container
//! manager, and a channel service with the full side-effect stack for
//! announcements, then drives the orchestrator from `macro.agent_sessions`.

mod config;

use std::sync::Arc;

use agent_harness::domain::model::SessionDefaults;
use agent_harness::domain::service::AgentHarnessService;
use agent_harness::inbound::kafka::agent_trigger_to_harness_command;
use agent_harness::outbound::channel_announcer::ChannelAnnouncer;
use agent_harness::outbound::daytona::{
    DaytonaApiKey as DaytonaApiKeySecret, DaytonaContainerManager, DaytonaSettings,
    GithubToken as GithubTokenSecret, Snapshot,
};
use agent_session::domain::service::AgentSessionServiceImpl;
use agent_session::outbound::postgres::PgAgentSessionRepo;
use agent_trigger::domain::broker_events::AgentSessionMacroEvent;
use anyhow::Context as _;
use bot_id::BotId;
use channels::domain::service::ChannelServiceImpl;
use channels::domain::side_effects::{ChannelSideEffectService, SpawnedChannelEventDispatcher};
use channels::outbound::connection_gateway_realtime::ConnectionGatewayChannelRealtimePublisher;
use channels::outbound::contacts_dispatcher::ContactsChannelDispatcher;
use channels::outbound::notification_sender::NotificationChannelSender;
use channels::outbound::pg_channels_repo::PgChannelsRepo;
use channels::outbound::pg_side_effect_context::PgChannelSideEffectContext;
use config::Config;
use connection_gateway_client::ConnectionGatewayClient;
use kafka_util::{GroupName, KafkaEventConsumer};
use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use macro_event_broker::{
    KafkaConsumerAdapter, KafkaEventPublisher, MacroEvent as _, MacroEventBrokerService,
    MacroEventCollection as _, MacroEventConsumerService,
};
use macro_service_urls::ConnectionGatewayUrl;
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
    if config.daytona_api_key.is_empty() {
        tracing::warn!(
            "DAYTONA_API_KEY is empty: the service will run, but opening a session will fail until it is set"
        );
    }

    let pool = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(5)
        .connect(config.database_url.as_ref())
        .await
        .context("failed to connect to macrodb")?;

    // Sessions: persistence and live actors.
    let session_repo = PgAgentSessionRepo::new(pool.clone());
    let sessions = AgentSessionServiceImpl::new(session_repo);

    // Containers: Daytona sandboxes.
    let containers = DaytonaContainerManager::new(DaytonaSettings {
        api_url: config.daytona_api_url.clone(),
        api_key: DaytonaApiKeySecret::new(config.daytona_api_key.clone()),
        snapshot: Snapshot::new(config.daytona_snapshot.clone()),
        github_token: GithubTokenSecret::new(config.github_token.clone()),
    });

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
    let connection_gateway = Arc::new(ConnectionGatewayClient::new(
        config.internal_api_key.clone(),
        ConnectionGatewayUrl::new()?.to_string(),
    ));
    let broker = MacroEventBrokerService::new(
        KafkaEventPublisher::new(config.kafka_brokers.as_ref())
            .context("failed to create kafka event publisher")?,
        macro_event_broker::GlobalSpawner,
    );
    let side_effects = ChannelSideEffectService::new(
        PgChannelSideEffectContext::new(pool.clone()),
        ConnectionGatewayChannelRealtimePublisher::new(connection_gateway),
        NotificationChannelSender::new(notifications),
        ContactsChannelDispatcher::new(contacts_ingress),
    )
    .with_macro_event_broker(broker);
    let channel_service = Arc::new(ChannelServiceImpl::with_dependencies(
        PgChannelsRepo::new(pool.clone()),
        SpawnedChannelEventDispatcher::new(side_effects),
        channels::domain::service::NoopChannelReferenceSharePermissions,
    ));
    let announcer = ChannelAnnouncer::new(channel_service, bot_id);

    let harness = Arc::new(AgentHarnessService::new(
        sessions,
        containers,
        announcer,
        SessionDefaults {
            model: config.harness_model.clone(),
            harness: config.harness_slug.clone(),
            repo_url: config.harness_repo_url.clone(),
        },
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

                let (session_id, command) = match agent_trigger_to_harness_command(event.event().event.clone(), bot_id) {
                    Ok(command) => command,
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
            Some(result) = tasks.join_next(), if !tasks.is_empty() => {
                if let Err(error) = result {
                    tracing::error!(error = ?error, "agent harness task failed");
                }
            }
        }
    }

    while let Some(result) = tasks.join_next().await {
        if let Err(error) = result {
            tracing::error!(error = ?error, "agent harness task failed during shutdown");
        }
    }

    match run_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}
