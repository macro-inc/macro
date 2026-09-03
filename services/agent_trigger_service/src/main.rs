//! Kafka worker that turns posted channel messages into agent-session events.

mod config;

use agent_session::outbound::postgres::PgAgentSessionRepo;
use agent_trigger::domain::processing::process_channel_event;
use agent_trigger::domain::service::AgentTriggerService;
use agent_trigger::outbound::{
    BotRepoAgentLookup, ChannelThreadHistory, FastModelTriggerJudge, LexicalExplicitReplyExtractor,
};
use anyhow::Context as _;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use channels::domain::broker_events::ChannelMacroEvent;
use channels::outbound::pg_channels_repo::PgChannelsRepo;
use config::Config;
use kafka_util::{GroupName, KafkaEventConsumer, consumer_span, record_span_error};
use lexical_client::LexicalClient;
use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use macro_event_broker::{
    KafkaConsumerAdapter, KafkaEventPublisher, MacroEvent as _, MacroEventBrokerService,
    MacroEventCollection as _, MacroEventConsumerService,
};
use macro_service_urls::LexicalServiceUrl;
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use sqlx::postgres::PgPoolOptions;
use tracing::Instrument as _;

struct AgentTriggerConsumerGroup;

impl GroupName for AgentTriggerConsumerGroup {
    const GROUP_NAME: &'static str = "agent-trigger-service";
}

macro_event_broker::declare_topics!(DeclaredMacroEvent: ChannelMacroEvent);

type TriggerKafkaAdapter = KafkaConsumerAdapter<AgentTriggerConsumerGroup, DeclaredMacroEvent>;
type TriggerConsumer = MacroEventConsumerService<DeclaredMacroEvent, TriggerKafkaAdapter>;

fn commit_message(consumer: &TriggerConsumer, message: &BorrowedMessage<'_>) -> anyhow::Result<()> {
    consumer
        .inner()
        .commit_message(message, CommitMode::Sync)
        .map_err(|error| anyhow::anyhow!("failed to commit channel event offset: {error:?}"))
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
        ChannelThreadHistory::new(PgChannelsRepo::new(pool)),
    );
    let publisher = MacroEventBrokerService::new(
        KafkaEventPublisher::new(config.kafka_brokers.as_ref())?,
        macro_event_broker::GlobalSpawner,
    );
    let consumer =
        KafkaEventConsumer::<AgentTriggerConsumerGroup>::from_env(config.kafka_brokers.as_ref())?;
    let consumer = KafkaConsumerAdapter::<AgentTriggerConsumerGroup, ()>::new(consumer)
        .subscribe::<DeclaredMacroEvent>()
        .map_err(|error| anyhow::anyhow!("failed to subscribe to channel events: {error:?}"))?;
    let consumer = TriggerConsumer::new(consumer);

    tracing::info!(
        topics = ?DeclaredMacroEvent::topics(),
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
                        tracing::error!(error = ?error, "failed to receive channel event");
                        continue;
                    }
                };
                let span = consumer_span(message.inner(), AgentTriggerConsumerGroup::GROUP_NAME);
                let result = async {
                    let kafka_message = message.inner();
                    let event = match message.decode_payload() {
                        Ok(DeclaredMacroEvent::ChannelMacroEvent(event)) => event,
                        Err(error) => {
                            record_span_error(&tracing::Span::current(), &error);
                            tracing::error!(
                                error = ?error,
                                partition = kafka_message.partition(),
                                offset = kafka_message.offset(),
                                "dropping undecodable channel event"
                            );
                            commit_message(&consumer, kafka_message)?;
                            return Ok::<(), anyhow::Error>(());
                        }
                    };
                    tracing::Span::current().record("macro.event.id", tracing::field::display(event.event().event_id));

                    process_channel_event(&trigger, &publisher, &event).await?;
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
