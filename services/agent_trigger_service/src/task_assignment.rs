//! Property-event consumer that emits agent-session triggers for task
//! assignments.
//!
//! The sibling of the channel-message loop in `main`: that one watches
//! channel messages for mentions, this one watches `macro.properties` for a
//! task's Assignees property gaining an agent, and both publish onto the
//! agent-sessions topic the harness consumes.

use agent_trigger::domain::processing::process_property_event;
use agent_trigger::domain::task_assignment::{TaskAssignmentTriggerService, TaskDirectory};
use agent_trigger::outbound::BotRepoAgentLookup;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use kafka_util::{GroupName, KafkaEventConsumer, consumer_span, record_span_error};
use macro_event_broker::{
    KafkaConsumerAdapter, KafkaEventPublisher, MacroEvent as _, MacroEventBrokerService,
    MacroEventCollection as _, MacroEventConsumerService,
};
use macro_uuid::Uuid;
use properties::domain::events::PropertyMacroEvent;
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use sqlx::PgPool;
use tokio::time::{Duration, sleep};
use tracing::Instrument as _;

struct TaskAssignmentConsumerGroup;

impl GroupName for TaskAssignmentConsumerGroup {
    const GROUP_NAME: &'static str = "agent-task-assignment-trigger";
}

macro_event_broker::declare_topics!(DeclaredPropertyEvent: PropertyMacroEvent);

type TaskTriggerKafkaAdapter =
    KafkaConsumerAdapter<TaskAssignmentConsumerGroup, DeclaredPropertyEvent>;
type TaskTriggerConsumer =
    MacroEventConsumerService<DeclaredPropertyEvent, TaskTriggerKafkaAdapter>;

/// Answers the trigger domain's one task question from the documents tables.
struct PgTaskDirectory {
    pool: PgPool,
}

impl TaskDirectory for PgTaskDirectory {
    async fn task_title(
        &self,
        task_id: Uuid,
    ) -> agent_session::domain::error::Result<Option<String>> {
        // Absent rather than an error: a title only makes the prompt and the
        // session name nicer, and the assignment stands without it.
        Ok(
            macro_db_client::document::get_document_name(&self.pool, &task_id.to_string())
                .await
                .inspect_err(|error| {
                    tracing::warn!(error = ?error, %task_id, "failed to read an assigned task's title");
                })
                .ok(),
        )
    }
}

fn commit_message(
    consumer: &TaskTriggerConsumer,
    message: &BorrowedMessage<'_>,
) -> anyhow::Result<()> {
    consumer
        .inner()
        .commit_message(message, CommitMode::Sync)
        .map_err(|error| anyhow::anyhow!("failed to commit property event offset: {error:?}"))
}

/// Keeps the task-assignment trigger consumer running across transient
/// failures.
pub async fn supervise(pool: PgPool, kafka_brokers: String) {
    loop {
        if let Err(error) = run(pool.clone(), kafka_brokers.clone()).await {
            tracing::error!(error = ?error, "agent task-assignment trigger stopped; restarting");
            sleep(Duration::from_secs(1)).await;
        }
    }
}

async fn run(pool: PgPool, kafka_brokers: String) -> anyhow::Result<()> {
    let trigger = TaskAssignmentTriggerService::new(
        BotRepoAgentLookup::new(PgBotsRepo::new(pool.clone())),
        BotRepoAgentLookup::new(PgBotsRepo::new(pool.clone())),
        PgTaskDirectory { pool },
    );
    let publisher = MacroEventBrokerService::new(
        KafkaEventPublisher::new(&kafka_brokers)?,
        macro_event_broker::GlobalSpawner,
    );
    let consumer = KafkaEventConsumer::<TaskAssignmentConsumerGroup>::from_env(&kafka_brokers)?;
    let consumer = KafkaConsumerAdapter::<TaskAssignmentConsumerGroup, ()>::new(consumer)
        .subscribe::<DeclaredPropertyEvent>()
        .map_err(|error| anyhow::anyhow!("failed to subscribe to property events: {error:?}"))?;
    let consumer = TaskTriggerConsumer::new(consumer);

    tracing::info!(
        topics = ?DeclaredPropertyEvent::topics(),
        group = TaskAssignmentConsumerGroup::GROUP_NAME,
        "agent task-assignment trigger listening"
    );

    loop {
        let message = match consumer.recv().await {
            Ok(message) => message,
            Err(error) => {
                tracing::error!(error = ?error, "failed to receive property event");
                sleep(Duration::from_secs(1)).await;
                continue;
            }
        };
        let span = consumer_span(message.inner(), TaskAssignmentConsumerGroup::GROUP_NAME);
        let result = async {
            let kafka_message = message.inner();
            let event = match message.decode_payload() {
                Ok(DeclaredPropertyEvent::PropertyMacroEvent(event)) => event,
                Err(error) => {
                    record_span_error(&tracing::Span::current(), &error);
                    tracing::error!(
                        error = ?error,
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                        "dropping undecodable property event"
                    );
                    commit_message(&consumer, kafka_message)?;
                    return Ok::<(), anyhow::Error>(());
                }
            };
            tracing::Span::current().record(
                "macro.event.id",
                tracing::field::display(event.event().event_id),
            );

            process_property_event(&trigger, &publisher, &event).await?;
            commit_message(&consumer, kafka_message)?;
            Ok(())
        }
        .instrument(span.clone())
        .await;
        if let Err(error) = &result {
            record_span_error(&span, error);
        }
        result?;
    }
}
