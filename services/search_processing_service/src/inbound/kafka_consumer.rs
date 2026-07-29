//! Kafka consumer for broker events that update the search index.
//!
//! The poll loop hands decoded events to one bounded, sequential worker and
//! commits each offset immediately after that handoff. Malformed records are
//! committed without a handoff so they cannot wedge a partition. Processing is
//! retried in-process; exhausted events are logged and dropped because their
//! offsets are already committed.

#[cfg(test)]
mod test;

use std::{future::Future, time::Duration};

use call::domain::events::{CallMacroEvent, CallTopicEvent};
use channels::domain::broker_events::{ChannelMacroEvent, ChannelTopicEvent};
use kafka_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection as _, MacroEventConsumerService,
};
use opensearch_client::OpensearchClient;
use rdkafka::{
    consumer::CommitMode,
    message::{BorrowedMessage, Message as _},
};
use rootcause::prelude::{Report, ResultExt as _};
use sqlx::PgPool;
use tokio::sync::mpsc;
use tokio_retry::{Retry, strategy::ExponentialBackoff};
use uuid::Uuid;

use crate::process::{
    call::{process_call_record, process_remove_call_record},
    channel::{process_channel_message_update, process_remove_channel_message},
};

/// Consumer group used for live search-index event offsets.
pub(crate) struct SearchProcessingConsumerGroup;

impl GroupName for SearchProcessingConsumerGroup {
    const GROUP_NAME: &'static str = "search-processing-service";
}

type SearchProcessingKafkaAdapter =
    KafkaConsumerAdapter<SearchProcessingConsumerGroup, SearchProcessingBrokerEvent>;
type SearchProcessingKafkaConsumer =
    MacroEventConsumerService<SearchProcessingBrokerEvent, SearchProcessingKafkaAdapter>;

macro_event_broker::declare_topics!(
    SearchProcessingBrokerEvent: CallMacroEvent, ChannelMacroEvent
);

/// Maximum number of decoded events waiting for the sequential worker.
const CHANNEL_CAPACITY: usize = 128;
/// Delay before polling Kafka again after a receive error.
const RECEIVE_ERROR_RETRY_DELAY: Duration = Duration::from_secs(1);
/// Total processing attempts before an event is dropped.
const MAX_PROCESSING_ATTEMPTS: u32 = 5;
/// Delay before the first retry; each later delay doubles.
const PROCESSING_RETRY_BASE_DELAY: Duration = Duration::from_secs(1);

/// A decoded search-processing event and its Kafka coordinates.
struct ReceivedEvent {
    event: SearchProcessingBrokerEvent,
    partition: i32,
    offset: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CallIndexAction {
    Upsert { call_id: Uuid },
    Remove { call_id: Uuid, channel_id: Uuid },
    Ignore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CallEventDescription {
    action: CallIndexAction,
    call_id: Uuid,
    event_type: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChannelIndexAction {
    UpsertMessage { channel_id: Uuid, message_id: Uuid },
    RemoveMessage { channel_id: Uuid, message_id: Uuid },
    RemoveChannel { channel_id: Uuid },
    Ignore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ChannelEventDescription {
    action: ChannelIndexAction,
    channel_id: Uuid,
    event_type: &'static str,
}

/// Outcome after the worker handles one decoded broker event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EventOutcome {
    /// The corresponding search-index operation succeeded.
    Indexed,
    /// The recognized event does not require a search-index operation.
    Ignored,
    /// Processing failed after all retries and the already-committed event was dropped.
    Dropped,
}

/// Result of decoding and attempting a channel handoff.
///
/// Both successful handoffs and malformed records are safe to commit. A closed
/// worker channel must leave the current record uncommitted so supervision can
/// restart the consumer and redeliver it.
#[derive(Debug)]
enum HandoffOutcome<E> {
    HandedOff,
    MalformedRecord(E),
    WorkerClosed,
}

fn describe_call_event(event: &CallTopicEvent) -> CallEventDescription {
    match event {
        CallTopicEvent::Started(metadata) => CallEventDescription {
            action: CallIndexAction::Ignore,
            call_id: metadata.call_id,
            event_type: "call.started",
        },
        CallTopicEvent::RecordArchived(metadata) => CallEventDescription {
            action: CallIndexAction::Upsert {
                call_id: metadata.call_id,
            },
            call_id: metadata.call_id,
            event_type: "call.record_archived",
        },
        CallTopicEvent::RecordUpdated(metadata) => CallEventDescription {
            action: CallIndexAction::Upsert {
                call_id: metadata.call_id,
            },
            call_id: metadata.call_id,
            event_type: "call.record_updated",
        },
        CallTopicEvent::RecordDeleted(metadata) => CallEventDescription {
            action: CallIndexAction::Remove {
                call_id: metadata.call_id,
                channel_id: metadata.channel_id,
            },
            call_id: metadata.call_id,
            event_type: "call.record_deleted",
        },
        CallTopicEvent::RecordSummarized(metadata) => CallEventDescription {
            action: CallIndexAction::Upsert {
                call_id: metadata.call_id,
            },
            call_id: metadata.call_id,
            event_type: "call.record_summarized",
        },
        CallTopicEvent::RecordingReady(metadata) => CallEventDescription {
            action: CallIndexAction::Ignore,
            call_id: metadata.call_id,
            event_type: "call.recording_ready",
        },
    }
}

fn describe_channel_event(event: &ChannelTopicEvent) -> ChannelEventDescription {
    match event {
        ChannelTopicEvent::Created(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::Ignore,
            channel_id: metadata.channel_id,
            event_type: "channel.created",
        },
        ChannelTopicEvent::Updated(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::Ignore,
            channel_id: metadata.channel_id,
            event_type: "channel.updated",
        },
        ChannelTopicEvent::Deleted(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::RemoveChannel {
                channel_id: metadata.channel_id,
            },
            channel_id: metadata.channel_id,
            event_type: "channel.deleted",
        },
        ChannelTopicEvent::MessagePosted(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::UpsertMessage {
                channel_id: metadata.channel_id,
                message_id: metadata.message_id,
            },
            channel_id: metadata.channel_id,
            event_type: "channel.message_posted",
        },
        ChannelTopicEvent::MessagePatched(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::UpsertMessage {
                channel_id: metadata.channel_id,
                message_id: metadata.message_id,
            },
            channel_id: metadata.channel_id,
            event_type: "channel.message_patched",
        },
        ChannelTopicEvent::MessageDeleted(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::RemoveMessage {
                channel_id: metadata.channel_id,
                message_id: metadata.message_id,
            },
            channel_id: metadata.channel_id,
            event_type: "channel.message_deleted",
        },
        ChannelTopicEvent::MessageAttachmentCreated(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::UpsertMessage {
                channel_id: metadata.channel_id,
                message_id: metadata.message_id,
            },
            channel_id: metadata.channel_id,
            event_type: "channel.message_attachment_created",
        },
        ChannelTopicEvent::MessageAttachmentRemoved(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::UpsertMessage {
                channel_id: metadata.channel_id,
                message_id: metadata.message_id,
            },
            channel_id: metadata.channel_id,
            event_type: "channel.message_attachment_removed",
        },
        ChannelTopicEvent::ParticipantAdded(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::Ignore,
            channel_id: metadata.channel_id,
            event_type: "channel.participant_added",
        },
        ChannelTopicEvent::ParticipantRemoved(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::Ignore,
            channel_id: metadata.channel_id,
            event_type: "channel.participant_removed",
        },
    }
}

fn processing_retry_strategy() -> impl Iterator<Item = Duration> {
    ExponentialBackoff::from_millis(2)
        .factor(500)
        .take((MAX_PROCESSING_ATTEMPTS - 1) as usize)
}

async fn retry_processing_with_strategy<I, F, Fut, E>(
    strategy: I,
    mut operation: F,
) -> Result<(), E>
where
    I: Iterator<Item = Duration>,
    F: FnMut(u32) -> Fut,
    Fut: Future<Output = Result<(), E>>,
{
    let mut attempt = 0;
    Retry::start(strategy, || {
        attempt += 1;
        operation(attempt)
    })
    .await
}

async fn retry_processing<F, Fut, E>(operation: F) -> Result<(), E>
where
    F: FnMut(u32) -> Fut,
    Fut: Future<Output = Result<(), E>>,
{
    retry_processing_with_strategy(processing_retry_strategy(), operation).await
}

async fn handoff_decoded<T, E>(
    sender: &mpsc::Sender<T>,
    decoded: Result<T, E>,
) -> HandoffOutcome<E> {
    let event = match decoded {
        Ok(event) => event,
        Err(error) => return HandoffOutcome::MalformedRecord(error),
    };

    match sender.send(event).await {
        Ok(()) => HandoffOutcome::HandedOff,
        Err(_) => HandoffOutcome::WorkerClosed,
    }
}

fn attach_event_coordinates<E>(
    decoded: Result<SearchProcessingBrokerEvent, E>,
    partition: i32,
    offset: i64,
) -> Result<ReceivedEvent, E> {
    decoded.map(|event| ReceivedEvent {
        event,
        partition,
        offset,
    })
}

async fn process_call_index_action(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    action: CallIndexAction,
) -> anyhow::Result<()> {
    match action {
        CallIndexAction::Upsert { call_id } => {
            process_call_record(opensearch_client, db, call_id, None).await
        }
        CallIndexAction::Remove {
            call_id,
            channel_id,
        } => process_remove_call_record(opensearch_client, channel_id, Some(call_id), None).await,
        CallIndexAction::Ignore => Ok(()),
    }
}

async fn process_channel_index_action(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    action: ChannelIndexAction,
) -> anyhow::Result<()> {
    match action {
        ChannelIndexAction::UpsertMessage {
            channel_id,
            message_id,
        } => {
            process_channel_message_update(opensearch_client, db, channel_id, message_id, None)
                .await
        }
        ChannelIndexAction::RemoveMessage {
            channel_id,
            message_id,
        } => {
            process_remove_channel_message(opensearch_client, channel_id, Some(message_id), None)
                .await
        }
        ChannelIndexAction::RemoveChannel { channel_id } => {
            process_remove_channel_message(opensearch_client, channel_id, None, None).await
        }
        ChannelIndexAction::Ignore => Ok(()),
    }
}

async fn process_call_event(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    event: &CallMacroEvent,
    partition: i32,
    offset: i64,
) -> EventOutcome {
    let description = describe_call_event(&event.event().event);
    if description.action == CallIndexAction::Ignore {
        tracing::trace!(
            call_id = %description.call_id,
            event_type = description.event_type,
            partition,
            offset,
            "ignoring call event without a search-index action"
        );
        return EventOutcome::Ignored;
    }

    let result = retry_processing(|attempt| async move {
        tracing::trace!(
            call_id = %description.call_id,
            event_type = description.event_type,
            partition,
            offset,
            attempt,
            "processing call search-index event"
        );
        process_call_index_action(db, opensearch_client, description.action)
            .await
            .inspect_err(|error| {
                if attempt < MAX_PROCESSING_ATTEMPTS {
                    let retry_delay =
                        PROCESSING_RETRY_BASE_DELAY * 2u32.pow(attempt.saturating_sub(1));
                    tracing::warn!(
                        error = ?error,
                        call_id = %description.call_id,
                        event_type = description.event_type,
                        partition,
                        offset,
                        attempt,
                        delay_secs = retry_delay.as_secs(),
                        "call search-index processing failed, retrying"
                    );
                }
            })
    })
    .await;

    match result {
        Ok(()) => EventOutcome::Indexed,
        Err(error) => {
            tracing::error!(
                error = ?error,
                call_id = %description.call_id,
                event_type = description.event_type,
                partition,
                offset,
                attempts = MAX_PROCESSING_ATTEMPTS,
                "dropping call event after processing retries were exhausted"
            );
            EventOutcome::Dropped
        }
    }
}

async fn process_channel_event(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    event: &ChannelMacroEvent,
    partition: i32,
    offset: i64,
) -> EventOutcome {
    let description = describe_channel_event(&event.event().event);
    if description.action == ChannelIndexAction::Ignore {
        tracing::trace!(
            channel_id = %description.channel_id,
            event_type = description.event_type,
            partition,
            offset,
            "ignoring channel event without a search-index action"
        );
        return EventOutcome::Ignored;
    }

    let result = retry_processing(|attempt| async move {
        tracing::trace!(
            channel_id = %description.channel_id,
            event_type = description.event_type,
            partition,
            offset,
            attempt,
            "processing channel search-index event"
        );
        process_channel_index_action(db, opensearch_client, description.action)
            .await
            .inspect_err(|error| {
                if attempt < MAX_PROCESSING_ATTEMPTS {
                    let retry_delay =
                        PROCESSING_RETRY_BASE_DELAY * 2u32.pow(attempt.saturating_sub(1));
                    tracing::warn!(
                        error = ?error,
                        channel_id = %description.channel_id,
                        event_type = description.event_type,
                        partition,
                        offset,
                        attempt,
                        delay_secs = retry_delay.as_secs(),
                        "channel search-index processing failed, retrying"
                    );
                }
            })
    })
    .await;

    match result {
        Ok(()) => EventOutcome::Indexed,
        Err(error) => {
            tracing::error!(
                error = ?error,
                channel_id = %description.channel_id,
                event_type = description.event_type,
                partition,
                offset,
                attempts = MAX_PROCESSING_ATTEMPTS,
                "dropping channel event after processing retries were exhausted"
            );
            EventOutcome::Dropped
        }
    }
}

#[tracing::instrument(skip(db, opensearch_client, event), fields(partition, offset))]
async fn process_event(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    event: &SearchProcessingBrokerEvent,
    partition: i32,
    offset: i64,
) -> EventOutcome {
    match event {
        SearchProcessingBrokerEvent::CallMacroEvent(event) => {
            process_call_event(db, opensearch_client, event, partition, offset).await
        }
        SearchProcessingBrokerEvent::ChannelMacroEvent(event) => {
            process_channel_event(db, opensearch_client, event, partition, offset).await
        }
    }
}

async fn run_event_worker(
    db: PgPool,
    opensearch_client: OpensearchClient,
    mut events: mpsc::Receiver<ReceivedEvent>,
) {
    while let Some(received) = events.recv().await {
        let _ = process_event(
            &db,
            &opensearch_client,
            &received.event,
            received.partition,
            received.offset,
        )
        .await;
    }
    tracing::trace!("search processing event worker drained");
}

fn commit_logged(consumer: &SearchProcessingKafkaConsumer, message: &BorrowedMessage<'_>) {
    match consumer.inner().commit_message(message, CommitMode::Async) {
        Ok(()) => tracing::trace!(
            topic = rdkafka::Message::topic(message),
            partition = message.partition(),
            offset = message.offset(),
            "committed search processing event offset"
        ),
        Err(error) => tracing::error!(
            error = ?error,
            topic = rdkafka::Message::topic(message),
            partition = message.partition(),
            offset = message.offset(),
            "failed to commit search processing event offset"
        ),
    }
}

async fn poll_events(
    consumer: &SearchProcessingKafkaConsumer,
    events: mpsc::Sender<ReceivedEvent>,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), Report> {
    let mut shutdown = std::pin::pin!(shutdown);
    loop {
        tokio::select! {
            _ = &mut shutdown => {
                tracing::info!("search processing event consumer shutting down");
                break;
            }
            result = consumer.recv() => {
                let message = match result {
                    Ok(message) => message,
                    Err(_) => { // error is logged in tracing automatically
                        tokio::time::sleep(RECEIVE_ERROR_RETRY_DELAY).await;
                        continue;
                    }
                };
                let kafka_message = message.inner();
                let decoded = attach_event_coordinates(
                    message.decode_payload(),
                    kafka_message.partition(),
                    kafka_message.offset(),
                );

                match handoff_decoded(&events, decoded).await {
                    HandoffOutcome::HandedOff => {}
                    HandoffOutcome::MalformedRecord(error) => tracing::error!(
                        error = ?error,
                        topic = rdkafka::Message::topic(kafka_message),
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                        "dropping undecodable search processing event"
                    ),
                    HandoffOutcome::WorkerClosed => {
                        tracing::error!(
                            topic = rdkafka::Message::topic(kafka_message),
                            partition = kafka_message.partition(),
                            offset = kafka_message.offset(),
                            "search processing event worker channel closed; leaving offset uncommitted"
                        );
                        return Err(rootcause::report!(
                            "search processing event worker channel closed for topic {} at partition {} offset {}",
                            rdkafka::Message::topic(kafka_message),
                            kafka_message.partition(),
                            kafka_message.offset(),
                        ));
                    }
                }

                // Deliberately commit immediately after a successful handoff. The worker
                // owns retries and drops exhausted events without requesting redelivery.
                commit_logged(consumer, kafka_message);
            }
        }
    }

    Ok(())
}

/// Runs the bounded broker event poll-loop/worker pair until `shutdown` resolves.
///
/// The caller is responsible for supervising this function. A closed worker
/// channel returns an error without committing the current Kafka message. On
/// normal shutdown the sender is dropped and all buffered events are processed
/// before this function returns.
#[tracing::instrument(skip(db, opensearch_client, shutdown), fields(brokers), err)]
pub(crate) async fn run_event_consumer(
    brokers: &str,
    db: PgPool,
    opensearch_client: OpensearchClient,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), Report> {
    let consumer = KafkaEventConsumer::<SearchProcessingConsumerGroup>::from_env(brokers)?;
    let consumer = KafkaConsumerAdapter::<SearchProcessingConsumerGroup, ()>::new(consumer)
        .subscribe::<SearchProcessingBrokerEvent>()
        .context("failed to subscribe to search processing event topics")?;
    let consumer = SearchProcessingKafkaConsumer::new(consumer);
    tracing::info!(
        topics = ?SearchProcessingBrokerEvent::topics(),
        group = SearchProcessingConsumerGroup::GROUP_NAME,
        "search processing event consumer listening"
    );

    let (events_tx, events_rx) = mpsc::channel(CHANNEL_CAPACITY);
    let worker = tokio::spawn(run_event_worker(db, opensearch_client, events_rx));
    let poll_result = poll_events(&consumer, events_tx, shutdown).await;
    let worker_result = worker.await;

    poll_result?;
    worker_result.map_err(|error| rootcause::report!(error))?;
    Ok(())
}
