//! Kafka consumer that ensures teammate DMs after `team.member_joined`.
//!
//! Subscribes to [`TeamMacroEvent`] on `macro.teams`. Other team events are
//! ignored and committed. Delivery is at-least-once: an event's offset is
//! committed only after the handler accepted it or permanently rejected it.
//! Transient failures retry in-process; if they persist the consumer exits
//! without committing so a supervisor redelivers. Undecodable messages are
//! logged and skipped rather than wedging the partition.

#[cfg(test)]
mod live;
#[cfg(test)]
mod test;

use crate::domain::{
    events::{TeamMacroEvent, TeamTopicEvent},
    teammate_dms::{TeammateDmError, TeammateDmService},
};
use anyhow::Context as _;
use kafka_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection as _, MacroEventConsumerService,
};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message};
use std::future::Future;
use std::time::Duration;
use tokio_retry::{RetryIf, strategy::ExponentialBackoff};

/// Consumer group for teammate direct-message sync.
struct TeammateDmsConsumerGroup;

impl GroupName for TeammateDmsConsumerGroup {
    const GROUP_NAME: &'static str = "teammate-dms";
}

type TeammateDmsKafkaAdapter = KafkaConsumerAdapter<TeammateDmsConsumerGroup, DeclaredMacroEvent>;
type TeammateDmsKafkaConsumer =
    MacroEventConsumerService<DeclaredMacroEvent, TeammateDmsKafkaAdapter>;

macro_event_broker::declare_topics!(DeclaredMacroEvent: TeamMacroEvent);

/// Maximum in-process attempts per event before the consumer bails out.
const MAX_ATTEMPTS: u32 = 5;

/// Delay before the first retry; doubles on each subsequent retry.
const RETRY_BASE_DELAY: Duration = Duration::from_secs(1);

fn retry_strategy() -> impl Iterator<Item = Duration> {
    ExponentialBackoff::from_millis(2)
        .factor(500)
        .take((MAX_ATTEMPTS - 1) as usize)
}

fn commit_logged(consumer: &TeammateDmsKafkaConsumer, message: &BorrowedMessage<'_>) {
    match consumer.inner().commit_message(message, CommitMode::Async) {
        Ok(()) => tracing::trace!(
            partition = message.partition(),
            offset = message.offset(),
            "committed offset"
        ),
        Err(error) => tracing::error!(
            error = ?error,
            partition = message.partition(),
            offset = message.offset(),
            "failed to commit offset"
        ),
    }
}

/// Apply one team event. Non-join events succeed immediately.
pub async fn handle_team_event<S: TeammateDmService>(
    service: &S,
    event: &TeamTopicEvent,
) -> Result<(), TeammateDmError> {
    match event {
        TeamTopicEvent::MemberJoined(metadata) => service
            .ensure_for_joined_member(&metadata.team_id, &metadata.member_id)
            .await
            .map(|_| ()),
        _ => Ok(()),
    }
}

async fn handle_with_retry<S: TeammateDmService>(
    service: &S,
    event: &TeamTopicEvent,
    partition: i32,
    offset: i64,
) -> anyhow::Result<()> {
    let mut attempt = 0u32;
    let result = RetryIf::start(
        retry_strategy(),
        || {
            attempt += 1;
            async move {
                tracing::trace!(partition, offset, attempt, "handling team event");
                let result = handle_team_event(service, event).await;
                match &result {
                    Ok(()) => {
                        tracing::trace!(partition, offset, attempt, "team event handled")
                    }
                    Err(error) if error.is_transient() && attempt < MAX_ATTEMPTS => {
                        let delay = RETRY_BASE_DELAY * 2u32.pow(attempt - 1);
                        tracing::warn!(
                            error = ?error,
                            partition,
                            offset,
                            attempt,
                            delay_secs = delay.as_secs_f32(),
                            "transient teammate DM failure, retrying"
                        );
                    }
                    Err(_) => {}
                }
                result
            }
        },
        |error: &TeammateDmError| error.is_transient(),
    )
    .await;

    match result {
        Ok(()) => Ok(()),
        Err(error) if !error.is_transient() => {
            tracing::error!(
                error = ?error,
                partition,
                offset,
                "dropping team event after non-retryable teammate DM failure"
            );
            Ok(())
        }
        Err(error) => Err(error).with_context(|| {
            format!(
                "transient teammate DM failure persisted after \
                 {MAX_ATTEMPTS} attempts \
                 (partition {partition} offset {offset})"
            )
        }),
    }
}

/// Run the teammate-DM consumer until `shutdown` resolves.
///
/// Connects to `brokers` and subscribes to `macro.teams` under the
/// `teammate-dms` consumer group. Callers should restart on error so the
/// uncommitted event is redelivered. Pass `std::future::pending()` as
/// `shutdown` to run until the process exits.
pub async fn run_teammate_dms_consumer<S>(
    brokers: &str,
    service: S,
    shutdown: impl Future<Output = ()> + Send,
) -> anyhow::Result<()>
where
    S: TeammateDmService,
{
    let consumer = KafkaEventConsumer::<TeammateDmsConsumerGroup>::from_env(brokers)?;
    let consumer = KafkaConsumerAdapter::<TeammateDmsConsumerGroup, ()>::new(consumer)
        .subscribe::<DeclaredMacroEvent>()
        .map_err(|error| anyhow::anyhow!("failed to subscribe to team events: {error:?}"))?;
    let consumer = TeammateDmsKafkaConsumer::new(consumer);
    tracing::info!(
        topics = ?DeclaredMacroEvent::topics(),
        group = TeammateDmsConsumerGroup::GROUP_NAME,
        "teammate DM consumer listening"
    );

    let mut shutdown = std::pin::pin!(shutdown);
    loop {
        tokio::select! {
            _ = &mut shutdown => {
                tracing::info!("teammate DM consumer shutting down");
                break;
            }
            result = consumer.recv() => {
                let message = match result {
                    Ok(message) => message,
                    Err(e) => {
                        tracing::error!(error = ?e, "kafka receive error");
                        continue;
                    }
                };
                let kafka_message = message.inner();
                match message.decode_payload() {
                    Ok(DeclaredMacroEvent::TeamMacroEvent(event)) => {
                        handle_with_retry(
                            &service,
                            &event.event().event,
                            kafka_message.partition(),
                            kafka_message.offset(),
                        )
                        .await?;
                    }
                    Err(e) => tracing::error!(
                        error = ?e,
                        topic = kafka_message.topic(),
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                        "failed to decode team event"
                    ),
                }

                commit_logged(&consumer, kafka_message);
            }
        }
    }

    Ok(())
}
