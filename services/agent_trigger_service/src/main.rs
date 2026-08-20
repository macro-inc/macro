//! Kafka worker that turns posted channel messages into agent-session events.

mod config;

use agent_session::outbound::postgres::PgAgentSessionRepo;
use agent_trigger::domain::service::{AgentBotLookup, AgentTriggerService};
use anyhow::Context as _;
use bots::domain::models::BotId;
use bots::domain::ports::BotRepo as _;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use channels::domain::broker_events::{ChannelMacroEvent, ChannelTopicEvent};
use config::Config;
use kafka_util::{GroupName, KafkaEventConsumer};
use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use macro_event_broker::{
    KafkaConsumerAdapter, KafkaEventPublisher, MacroEvent as _, MacroEventBroker as _,
    MacroEventBrokerService, MacroEventCollection as _, MacroEventConsumerService,
};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use sqlx::postgres::PgPoolOptions;

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

struct PgAgentBotLookup(PgBotsRepo);

impl AgentBotLookup for PgAgentBotLookup {
    async fn has_agent(&self, bot_id: BotId) -> agent_session::domain::error::Result<bool> {
        self.0
            .get_bot(bot_id)
            .await
            .map(|bot| bot.is_some_and(|bot| bot.has_agent))
            .map_err(agent_session::domain::error::AgentSessionError::Unknown)
    }
}

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    let config = Config::from_env()?;
    let pool = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(5)
        .connect(config.database_url.as_ref())
        .await
        .context("failed to connect to macrodb")?;

    let trigger = AgentTriggerService::new(
        PgAgentSessionRepo::new(pool.clone()),
        PgAgentBotLookup(PgBotsRepo::new(pool)),
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
                let kafka_message = message.inner();
                let event = match message.decode_payload() {
                    Ok(DeclaredMacroEvent::ChannelMacroEvent(event)) => event,
                    Err(error) => {
                        tracing::error!(
                            error = ?error,
                            partition = kafka_message.partition(),
                            offset = kafka_message.offset(),
                            "dropping undecodable channel event"
                        );
                        commit_message(&consumer, kafka_message)?;
                        continue;
                    }
                };

                let ChannelTopicEvent::MessagePosted(posted) = &event.event().event else {
                    commit_message(&consumer, kafka_message)?;
                    continue;
                };
                let yielded_events = trigger.evaluate(posted).await?;
                if yielded_events.is_empty() {
                    tracing::debug!(message_id = %posted.message_id, "agent trigger yielded no event");
                }
                for yielded in yielded_events {
                    let json = serde_json::to_string(yielded.event())?;
                    tracing::info!(yielded_event = %json, "agent trigger yielded event");
                    let publish = publisher.send_event(&yielded)?;
                    publish.await.context("agent event publication task failed")??;
                }

                commit_message(&consumer, kafka_message)?;
            }
        }
    }

    Ok(())
}
