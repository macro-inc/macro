//! Kafka worker that turns committed posts into agent-session events.

// The consumer loop is generic over the trigger source, and the select! it
// awaits in nests the concrete service types past the default query depth.
#![recursion_limit = "256"]

mod config;

use agent_session::outbound::postgres::PgAgentSessionRepo;
use agent_trigger::domain::processing::process_message_event;
use agent_trigger::domain::service::AgentTriggerService;
use agent_trigger::domain::sources::{ChannelTriggerEvents, MessageTriggerEvents, TriggerEvents};
use agent_trigger::outbound::{
    BotRepoAgentLookup, ChannelRepoTypeLookup, FastModelTriggerJudge,
    LexicalExplicitReplyExtractor, MessageThreadHistory,
};
use anyhow::Context as _;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use channels::outbound::pg_channels_repo::PgChannelsRepo;
use config::Config;
use kafka_util::{GroupName, KafkaEventConsumer, consumer_span, record_span_error};
use lexical_client::LexicalClient;
use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use macro_event_broker::{
    KafkaConsumerAdapter, KafkaEventPublisher, MacroEventBrokerService, MacroEventCollection,
    MacroEventConsumerService,
};
use macro_service_urls::LexicalServiceUrl;
use messages::outbound::pg_message_repo::PgMessageRepository;
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use sqlx::postgres::PgPoolOptions;
use tracing::Instrument as _;

struct AgentTriggerConsumerGroup;

impl GroupName for AgentTriggerConsumerGroup {
    const GROUP_NAME: &'static str = "agent-trigger-service";
}

/// The concrete trigger service this binary composes.
type Trigger = AgentTriggerService<
    PgAgentSessionRepo,
    BotRepoAgentLookup<PgBotsRepo>,
    BotRepoAgentLookup<PgBotsRepo>,
    BotRepoAgentLookup<PgBotsRepo>,
    LexicalExplicitReplyExtractor,
    FastModelTriggerJudge,
    MessageThreadHistory<
        entity_access::domain::service::EntityAccessServiceImpl<
            entity_access::outbound::PgAccessRepository,
        >,
    >,
>;
type Publisher = MacroEventBrokerService<KafkaEventPublisher, macro_event_broker::GlobalSpawner>;
type ChannelTypes = ChannelRepoTypeLookup<PgChannelsRepo>;

type TriggerKafkaAdapter<M> = KafkaConsumerAdapter<AgentTriggerConsumerGroup, M>;
type TriggerConsumer<M> = MacroEventConsumerService<M, TriggerKafkaAdapter<M>>;

fn commit_message<M: MacroEventCollection + 'static>(
    consumer: &TriggerConsumer<M>,
    message: &BorrowedMessage<'_>,
) -> anyhow::Result<()> {
    consumer
        .inner()
        .commit_message(message, CommitMode::Sync)
        .map_err(|error| anyhow::anyhow!("failed to commit trigger event offset: {error:?}"))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = run().await;
    entrypoint.shutdown();
    result
}

async fn run() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    let pool = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(5)
        .connect(config.database_url.as_ref())
        .await
        .context("failed to connect to macrodb")?;

    let lexical = LexicalClient::new(
        config.internal_api_key.clone(),
        LexicalServiceUrl::new()?.to_string(),
    );
    let trigger = AgentTriggerService::new(
        PgAgentSessionRepo::new(pool.clone()),
        BotRepoAgentLookup::new(PgBotsRepo::new(pool.clone())),
        BotRepoAgentLookup::new(PgBotsRepo::new(pool.clone())),
        BotRepoAgentLookup::new(PgBotsRepo::new(pool.clone())),
        LexicalExplicitReplyExtractor::new(lexical),
        FastModelTriggerJudge::new(ai_usage::pg_recorder(pool.clone())),
        MessageThreadHistory::new(
            std::sync::Arc::new(messages::domain::service::MessageService::new(
                PgMessageRepository::new(pool.clone()).with_initiatives(
                    initiative::domain::lookup::InitiativeLookup::new(
                        initiative::outbound::PgInitiativeRepo::new(pool.clone()),
                    ),
                ),
                messages::domain::ports::NoMessageEventPublisher,
            )),
            entity_access::domain::service::EntityAccessServiceImpl::new(
                entity_access::outbound::PgAccessRepository::new(pool.clone()),
            ),
        ),
    );
    let channel_types = ChannelRepoTypeLookup::new(PgChannelsRepo::new(pool));
    let publisher = MacroEventBrokerService::new(
        KafkaEventPublisher::new(config.kafka_brokers.as_ref())?,
        macro_event_broker::GlobalSpawner,
    );
    let consumer =
        KafkaEventConsumer::<AgentTriggerConsumerGroup>::from_env(config.kafka_brokers.as_ref())?;
    let consumer = KafkaConsumerAdapter::<AgentTriggerConsumerGroup, ()>::new(consumer);

    match config.agent_trigger_event_source {
        agent_trigger::domain::sources::TriggerEventSource::Messages => {
            consume::<MessageTriggerEvents>(consumer, &trigger, &publisher, &channel_types).await
        }
        agent_trigger::domain::sources::TriggerEventSource::Channels => {
            consume::<ChannelTriggerEvents>(consumer, &trigger, &publisher, &channel_types).await
        }
    }
}

/// Read one trigger source until shutdown, evaluating every committed post.
async fn consume<Events: TriggerEvents>(
    consumer: KafkaConsumerAdapter<AgentTriggerConsumerGroup, ()>,
    trigger: &Trigger,
    publisher: &Publisher,
    channel_types: &ChannelTypes,
) -> anyhow::Result<()> {
    let consumer = consumer
        .subscribe::<Events>()
        .map_err(|error| anyhow::anyhow!("failed to subscribe to trigger events: {error:?}"))?;
    let consumer = TriggerConsumer::<Events>::new(consumer);

    tracing::info!(
        topics = ?Events::topics(),
        source = ?Events::SOURCE,
        group = AgentTriggerConsumerGroup::GROUP_NAME,
        "agent trigger service listening"
    );

    let mut shutdown = std::pin::pin!(shutdown_signal());
    let mut run_error = None;
    loop {
        tokio::select! {
            () = &mut shutdown => {
                tracing::info!("agent trigger service shutting down");
                break;
            }
            result = consumer.recv() => {
                let message = match result {
                    Ok(message) => message,
                    Err(error) => {
                        tracing::error!(error = ?error, "failed to receive trigger event");
                        continue;
                    }
                };
                let span = consumer_span(message.inner(), AgentTriggerConsumerGroup::GROUP_NAME);
                let result = async {
                    let kafka_message = message.inner();
                    let decoded = match message.decode_payload() {
                        Ok(decoded) => decoded.into_trigger(),
                        Err(error) => {
                            record_span_error(&tracing::Span::current(), &error);
                            tracing::error!(
                                error = ?error,
                                partition = kafka_message.partition(),
                                offset = kafka_message.offset(),
                                "dropping undecodable trigger event"
                            );
                            commit_message(&consumer, kafka_message)?;
                            return Ok::<(), anyhow::Error>(());
                        }
                    };
                    tracing::Span::current().record("macro.event.id", tracing::field::display(decoded.event_id));
                    tracing::Span::current().record("macro.event.type", decoded.event_type);

                    if let Some(posted) = &decoded.posted {
                        process_message_event(trigger, publisher, channel_types, posted).await?;
                    }
                    commit_message(&consumer, kafka_message)?;
                    Ok(())
                }
                .instrument(span.clone())
                .await;
                if let Err(error) = &result {
                    record_span_error(&span, error);
                }
                if let Err(error) = result {
                    run_error = Some(error);
                    break;
                }
            }
        }
    }

    match run_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}
