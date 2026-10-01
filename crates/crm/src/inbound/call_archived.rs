//! Kafka consumer linking archived calls to CRM records.
//!
//! Consumes the call topic and links each archived call record to the CRM
//! companies and contacts of the people on it. Delivery is at least once:
//! malformed messages and other call events are committed so they cannot
//! wedge a partition. A failed link is retried with backoff; one that still
//! fails is logged and committed, so a bad record never stalls the calls
//! behind it (the backfill can re-link it). Shutting down mid-retry leaves the
//! event uncommitted to replay on restart. Links are insert-if-absent, so
//! replays are harmless.

use std::{future::Future, time::Duration};

use call::domain::{
    events::{CallMacroEvent, CallTopicEvent},
    ports::CallRecordQueryService,
};
use kafka_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection, MacroEventConsumerService,
};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use rootcause::prelude::{Report, ResultExt as _};
use tracing::Instrument as _;
use uuid::Uuid;

use crate::domain::call_links::{CallRecordLinkStore, CallRecordLinker};

#[cfg(test)]
mod test;

#[allow(clippy::enum_variant_names)]
mod source {
    use super::CallMacroEvent;

    macro_event_broker::declare_topics!(CallSourceEvent: CallMacroEvent);
}
use source::CallSourceEvent;

/// Consumer group for CRM call-link offsets.
struct CrmCallLinksGroup;

impl GroupName for CrmCallLinksGroup {
    const GROUP_NAME: &'static str = "crm-call-links";
}

/// Attempts per event before a failing link is logged and skipped.
const MAX_ATTEMPTS: u32 = 4;
/// Delay before the first retry; it doubles with each attempt.
const FIRST_RETRY_DELAY: Duration = Duration::from_secs(1);

/// Links archived call records to CRM records as their events arrive.
pub struct CallArchivedConsumer<Q, L> {
    linker: CallRecordLinker<Q, L>,
    first_retry_delay: Duration,
}

impl<Q: CallRecordQueryService, L: CallRecordLinkStore> CallArchivedConsumer<Q, L> {
    /// Build the consumer over a call-record linker.
    pub fn new(linker: CallRecordLinker<Q, L>) -> Self {
        Self {
            linker,
            first_retry_delay: FIRST_RETRY_DELAY,
        }
    }

    /// Applies one call event: archived records are linked, every other
    /// event is ignored.
    async fn apply(&self, event: &CallTopicEvent) -> Result<(), Report> {
        match event {
            CallTopicEvent::RecordArchived(metadata) => {
                self.linker.link_archived_call(metadata.call_id).await
            }
            _ => Ok(()),
        }
    }

    /// Applies one event, retrying failures with exponential backoff, and
    /// gives up after [`MAX_ATTEMPTS`] with an error log.
    async fn apply_with_retries(&self, event: &CallTopicEvent) {
        let call_record_id: Option<Uuid> = match event {
            CallTopicEvent::RecordArchived(metadata) => Some(metadata.call_id),
            _ => None,
        };
        let mut delay = self.first_retry_delay;
        for attempt in 1..=MAX_ATTEMPTS {
            let Err(error) = self.apply(event).await else {
                return;
            };
            if attempt == MAX_ATTEMPTS {
                tracing::error!(
                    error = ?error,
                    ?call_record_id,
                    attempts = MAX_ATTEMPTS,
                    "giving up linking call record to CRM records"
                );
                return;
            }
            tracing::warn!(
                error = ?error,
                ?call_record_id,
                attempt,
                "failed to link call record to CRM records; retrying"
            );
            tokio::time::sleep(delay).await;
            delay *= 2;
        }
    }

    /// Runs the consumer until `shutdown` resolves.
    #[tracing::instrument(skip(self, shutdown), err)]
    pub async fn run(
        &self,
        brokers: &str,
        shutdown: impl Future<Output = ()> + Send,
    ) -> Result<(), Report> {
        let consumer = KafkaEventConsumer::<CrmCallLinksGroup>::from_env(brokers)?;
        let consumer = KafkaConsumerAdapter::<CrmCallLinksGroup, ()>::new(consumer)
            .subscribe::<CallSourceEvent>()
            .context("failed to subscribe to the call topic")?;
        let consumer = MacroEventConsumerService::<CallSourceEvent, _>::new(consumer);
        tracing::info!(
            topics = ?CallSourceEvent::topics(),
            group = CrmCallLinksGroup::GROUP_NAME,
            "CRM call-link consumer listening"
        );

        let mut shutdown = std::pin::pin!(shutdown);
        loop {
            tokio::select! {
                _ = &mut shutdown => {
                    tracing::info!("CRM call-link consumer shutting down");
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
                    let span = tracing::info_span!(
                        "crm_call_link_event",
                        topic = kafka_message.topic(),
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                    );
                    let decoded = {
                        let _guard = span.enter();
                        message.decode_payload()
                    };
                    let Ok(CallSourceEvent::CallMacroEvent(event)) = decoded else {
                        // Poison record: commit so it cannot wedge the partition.
                        commit_logged(&consumer, kafka_message);
                        continue;
                    };

                    // Shutting down mid-retry leaves the event uncommitted so
                    // it replays on restart.
                    tokio::select! {
                        _ = &mut shutdown => break,
                        () = self.apply_with_retries(&event.event().event).instrument(span) => {}
                    }
                    commit_logged(&consumer, kafka_message);
                }
            }
        }

        Ok(())
    }
}

fn commit_logged<C: MacroEventCollection + 'static>(
    consumer: &MacroEventConsumerService<C, KafkaConsumerAdapter<CrmCallLinksGroup, C>>,
    message: &BorrowedMessage<'_>,
) {
    if let Err(error) = consumer.inner().commit_message(message, CommitMode::Async) {
        tracing::error!(
            error = ?error,
            partition = message.partition(),
            offset = message.offset(),
            "failed to commit offset"
        );
    }
}
