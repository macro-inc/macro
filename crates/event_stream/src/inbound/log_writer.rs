//! The `public-event-log` consumer: every topic with public events (and the
//! internal ones that change access), appended to the public event log.
//!
//! Grouped, so instances split partitions and per-entity order holds (one
//! partition, one writer). Starts at `Latest`: the log is a one-hour window,
//! so replaying a topic's retention would only be trimmed again. Commits
//! after the append; a record that cannot be decoded or violates its
//! exposure is logged and committed, so one bad record never stalls a
//! partition. An append that keeps failing exits without committing, and the
//! supervisor's restart redelivers it.

use crate::domain::log_writer::{LogWriter, WriteOutcome, WriterSwitches};
use crate::domain::ports::EventLog;
use crate::topics::LogMacroEvent;
use kafka_util::{GroupName, InitialOffset, KafkaEventConsumer, consumer_span, record_span_error};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEventCollection as _, MacroEventConsumerService,
};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use std::future::Future;
use std::time::Duration;
use tracing::Instrument as _;

/// The writer's consumer group.
pub struct PublicEventLogGroup;

impl GroupName for PublicEventLogGroup {
    const GROUP_NAME: &'static str = "public-event-log";
    // Deliberate: a new group, or a topic newly added to it, starts at its
    // head. The log keeps an hour; older records would be trimmed at once.
    const INITIAL_OFFSET: InitialOffset = InitialOffset::Latest;
}

type LogKafkaAdapter = KafkaConsumerAdapter<PublicEventLogGroup, LogMacroEvent>;
type LogKafkaConsumer = MacroEventConsumerService<LogMacroEvent, LogKafkaAdapter>;

/// Append attempts per record before the consumer gives up uncommitted.
const MAX_APPEND_ATTEMPTS: u32 = 5;

/// Delay before the first retry; doubles each retry (1+2+4+8 s, well under
/// the 300 s poll interval).
const APPEND_RETRY_BASE_DELAY: Duration = Duration::from_secs(1);

fn commit_logged(consumer: &LogKafkaConsumer, message: &BorrowedMessage<'_>) {
    if let Err(error) = consumer.inner().commit_message(message, CommitMode::Async) {
        tracing::error!(
            error = ?error,
            partition = message.partition(),
            offset = message.offset(),
            "failed to commit a public event log offset"
        );
    }
}

/// Run the writer until `shutdown`. Returns an error when the consumer
/// cannot start or an append keeps failing; the caller restarts it.
pub async fn run_public_event_log_writer<L, S>(
    brokers: &str,
    writer: &LogWriter<L, S>,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), rootcause::Report>
where
    L: EventLog,
    S: WriterSwitches,
{
    let consumer = KafkaEventConsumer::<PublicEventLogGroup>::from_env(brokers)
        .map_err(|error| rootcause::report!(error))?;
    let consumer = KafkaConsumerAdapter::<PublicEventLogGroup, ()>::new(consumer)
        .subscribe::<LogMacroEvent>()
        .map_err(|error| {
            rootcause::report!("failed to subscribe the public event log writer: {error:?}")
        })?;
    let consumer = LogKafkaConsumer::new(consumer);
    tracing::info!(
        topics = ?LogMacroEvent::topics(),
        group = PublicEventLogGroup::GROUP_NAME,
        "public event log writer listening"
    );

    let mut shutdown = std::pin::pin!(shutdown);
    loop {
        let message = tokio::select! {
            biased;
            () = &mut shutdown => return Ok(()),
            message = consumer.recv() => message,
        };
        let message = match message {
            Ok(message) => message,
            Err(error) => {
                tracing::error!(error = ?error, "kafka receive error");
                continue;
            }
        };
        let kafka_message = message.inner();
        let span = consumer_span(kafka_message, PublicEventLogGroup::GROUP_NAME);
        async {
            match message.decode_payload() {
                Ok(event) => {
                    let outcome = append_with_retry(writer, kafka_message.topic(), &event).await?;
                    if let (WriteOutcome::Appended(cursor), Some(published_ms)) =
                        (outcome, kafka_message.timestamp().to_millis())
                    {
                        crate::metrics::metrics().append_lag_ms.record(
                            cursor
                                .ms
                                .saturating_sub(u64::try_from(published_ms).unwrap_or_default()),
                            &[],
                        );
                    }
                }
                Err(error) => {
                    record_span_error(&tracing::Span::current(), &error);
                    tracing::error!(
                        error = ?error,
                        topic = kafka_message.topic(),
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                        "skipping an undecodable broker event"
                    );
                }
            }
            commit_logged(&consumer, kafka_message);
            Ok::<(), rootcause::Report>(())
        }
        .instrument(span)
        .await?;
    }
}

async fn append_with_retry<L: EventLog, S: WriterSwitches>(
    writer: &LogWriter<L, S>,
    topic: &str,
    event: &LogMacroEvent,
) -> Result<WriteOutcome, rootcause::Report> {
    let mut attempt = 1;
    loop {
        match writer.write(topic, event).await {
            Ok(outcome) => return Ok(outcome),
            Err(error) if attempt < MAX_APPEND_ATTEMPTS => {
                let delay = APPEND_RETRY_BASE_DELAY * 2u32.pow(attempt - 1);
                tracing::warn!(error = ?error, attempt, "public event log append failed; retrying");
                tokio::time::sleep(delay).await;
                attempt += 1;
            }
            Err(error) => {
                record_span_error(&tracing::Span::current(), &error);
                return Err(error);
            }
        }
    }
}
