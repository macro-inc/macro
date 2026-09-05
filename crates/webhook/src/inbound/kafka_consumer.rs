//! Kafka consumer that feeds broker events into webhook ingestion.
//!
//! Subscribes to [`DocumentMacroEvent`], [`ChannelMacroEvent`], and
//! [`WebhookMacroEvent`] topics and hands every decoded event envelope to a
//! [`WebhookEventIngestionService`].
//!
//! Delivery is at-least-once: an event's offset is committed only after the
//! ingestion service accepted it or permanently rejected it. Transient
//! ingestion failures (e.g. the database being briefly unavailable while
//! resolving entity access) are retried in-process with exponential backoff;
//! if a transient failure outlives every attempt the consumer exits with an
//! error *without* committing, so the supervising restart loop redelivers the
//! event and retries durably. Undecodable messages are logged and skipped
//! rather than wedging the partition. The transport mirrors
//! [`macro_event_broker::KafkaEventPublisher`]: plaintext for
//! `ENVIRONMENT=local`, TLS + SASL/OAUTHBEARER with MSK IAM otherwise.
//!
//! For local testing, run with `RUST_LOG=webhook=trace` to see every received
//! message, decoded event, ingestion attempt, and offset commit.

#[cfg(test)]
mod test;

use crate::domain::ingestion::{WebhookEventIngestionError, WebhookEventIngestionService};
use crate::topics::DeclaredMacroEvent;
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

/// Consumer group for webhook event ingestion. Offsets are committed under
/// this group, so restarts resume where the previous run left off.
struct WebhookEventIngestionConsumerGroup;

impl GroupName for WebhookEventIngestionConsumerGroup {
    const GROUP_NAME: &'static str = "webhook-event-ingestion";
}

type WebhookKafkaAdapter =
    KafkaConsumerAdapter<WebhookEventIngestionConsumerGroup, DeclaredMacroEvent>;
type WebhookKafkaConsumer = MacroEventConsumerService<DeclaredMacroEvent, WebhookKafkaAdapter>;

/// Maximum in-process ingestion attempts per event before the consumer bails
/// out and lets a restart redeliver from the last committed offset.
const MAX_INGEST_ATTEMPTS: u32 = 5;

/// Delay before the first ingestion retry; doubles on each subsequent retry.
/// The worst-case total backoff (1+2+4+8 = 15s) stays well under librdkafka's
/// default `max.poll.interval.ms` (300s), so retrying never evicts this
/// consumer from its group.
const INGEST_RETRY_BASE_DELAY: Duration = Duration::from_secs(1);

fn ingest_retry_strategy() -> impl Iterator<Item = Duration> {
    ExponentialBackoff::from_millis(2)
        .factor(500)
        .take((MAX_INGEST_ATTEMPTS - 1) as usize)
}

/// Commit `message`'s offset, logging the outcome.
fn commit_logged(consumer: &WebhookKafkaConsumer, message: &BorrowedMessage<'_>) {
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

/// Ingest one decoded event, retrying transient failures with exponential
/// backoff.
///
/// Returns `Ok(())` when the event was ingested or permanently rejected (both
/// safe to commit) and `Err` when a transient failure survived every attempt —
/// the caller must exit without committing so the event is redelivered.
async fn ingest_with_retry<S: WebhookEventIngestionService>(
    service: &S,
    event: &DeclaredMacroEvent,
    partition: i32,
    offset: i64,
) -> anyhow::Result<()> {
    let mut attempt = 0u32;
    let result = RetryIf::start(
        ingest_retry_strategy(),
        || {
            attempt += 1;
            async move {
                tracing::trace!(partition, offset, attempt, "ingesting broker event");
                let result = match event {
                    DeclaredMacroEvent::DocumentMacroEvent(event) => {
                        service.ingest_document_event(event.event().clone()).await
                    }
                    DeclaredMacroEvent::ChannelMacroEvent(event) => {
                        service.ingest_channel_event(event.event().clone()).await
                    }
                    DeclaredMacroEvent::WebhookMacroEvent(event) => {
                        service.ingest_webhook_event(event.event().clone()).await
                    }
                    DeclaredMacroEvent::AgentSessionMacroEvent(event) => {
                        service
                            .ingest_agent_trigger_event(event.event().clone())
                            .await
                    }
                };

                match &result {
                    Ok(()) => {
                        tracing::trace!(partition, offset, attempt, "broker event ingested")
                    }
                    Err(error) if error.is_transient() && attempt < MAX_INGEST_ATTEMPTS => {
                        let delay = INGEST_RETRY_BASE_DELAY * 2u32.pow(attempt - 1);
                        tracing::warn!(
                            error = ?error,
                            partition,
                            offset,
                            attempt,
                            delay_secs = delay.as_secs_f32(),
                            "transient ingestion failure, retrying"
                        );
                    }
                    Err(_) => {}
                }
                result
            }
        },
        |error: &WebhookEventIngestionError| error.is_transient(),
    )
    .await;

    match result {
        Ok(()) => Ok(()),
        Err(error) if !error.is_transient() => {
            tracing::error!(
                error = ?error,
                partition,
                offset,
                "dropping broker event after non-retryable ingestion failure"
            );
            Ok(())
        }
        Err(error) => Err(error).with_context(|| {
            format!(
                "transient ingestion failure persisted after \
                 {MAX_INGEST_ATTEMPTS} attempts \
                 (partition {partition} offset {offset})"
            )
        }),
    }
}

/// Run the webhook event consumer until `shutdown` resolves.
///
/// Connects to `brokers` and subscribes to the topics declared by
/// [`DocumentMacroEvent`], [`ChannelMacroEvent`], and [`WebhookMacroEvent`]
/// under the `webhook-event-ingestion` consumer group. Every decoded event is fed to
/// `service`, committing each offset only
/// after ingestion succeeds (see `ingest_with_retry` for the retry policy).
/// Returns an error when the consumer cannot be created or subscribed, or when
/// a transient ingestion failure exhausts its in-process retries; callers
/// should treat that as fatal and restart, which redelivers the uncommitted
/// event. Pass `std::future::pending()` as `shutdown` to run until the process
/// exits.
pub async fn run_webhook_event_consumer<S>(
    brokers: &str,
    service: S,
    shutdown: impl Future<Output = ()> + Send,
) -> anyhow::Result<()>
where
    S: WebhookEventIngestionService,
{
    let consumer = KafkaEventConsumer::<WebhookEventIngestionConsumerGroup>::from_env(brokers)?;
    let consumer = KafkaConsumerAdapter::<WebhookEventIngestionConsumerGroup, ()>::new(consumer)
        .subscribe::<DeclaredMacroEvent>()
        .map_err(|error| {
            anyhow::anyhow!("failed to subscribe to webhook event topics: {error:?}")
        })?;
    let consumer = WebhookKafkaConsumer::new(consumer);
    tracing::info!(
        topics = ?DeclaredMacroEvent::topics(),
        group = WebhookEventIngestionConsumerGroup::GROUP_NAME,
        "webhook event consumer listening"
    );

    let mut shutdown = std::pin::pin!(shutdown);
    loop {
        tokio::select! {
            _ = &mut shutdown => {
                tracing::info!("webhook event consumer shutting down");
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
                    Ok(event) => {
                        tracing::trace!(
                            partition = kafka_message.partition(),
                            offset = kafka_message.offset(),
                            "decoded broker event"
                        );
                        ingest_with_retry(
                            &service,
                            &event,
                            kafka_message.partition(),
                            kafka_message.offset(),
                        )
                        .await?;
                    }
                    // Undecodable messages are logged and skipped rather than
                    // wedging the partition on a poison message.
                    Err(e) => tracing::error!(
                        error = ?e,
                        topic = kafka_message.topic(),
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                        "failed to decode broker event"
                    ),
                }

                // Commit only after the event was ingested or permanently
                // rejected: at-least-once, retried across restarts.
                commit_logged(&consumer, kafka_message);
            }
        }
    }

    Ok(())
}
