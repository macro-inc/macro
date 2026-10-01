//! Kafka consumer linking archived calls to CRM records.
//!
//! Consumes the call topic and links each archived call record to the CRM
//! companies and contacts of the people on it. Delivery is at least once:
//! malformed messages and other call events are committed so they cannot
//! wedge a partition, while a failed link aborts the run **without
//! committing**, and the host supervisor restarts the consumer from the last
//! committed offset. Links are insert-if-absent, so replays are harmless.

use std::future::Future;

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

/// Links archived call records to CRM records as their events arrive.
pub struct CallArchivedConsumer<Q, L> {
    linker: CallRecordLinker<Q, L>,
}

impl<Q: CallRecordQueryService, L: CallRecordLinkStore> CallArchivedConsumer<Q, L> {
    /// Build the consumer over a call-record linker.
    pub fn new(linker: CallRecordLinker<Q, L>) -> Self {
        Self { linker }
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

                    // A failed link must abort the run: committing a later
                    // record on this partition would cumulatively commit
                    // past the failed one. The supervisor restarts from the
                    // last committed offset.
                    tokio::select! {
                        _ = &mut shutdown => break,
                        result = self.apply(&event.event().event).instrument(span) => {
                            result.context("failed to link call record to CRM records")?;
                        }
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
