//! Process-level Kafka consumer feeding the local webhook stream hub.

use crate::domain::ingestion::{
    WebhookEventIngestionError, agent_trigger_stream_candidate, channel_stream_candidate,
    document_stream_candidate, webhook_stream_candidate,
};
use crate::domain::stream::{StreamCandidateEvent, WebhookStreamCandidateSink};
use crate::topics::DeclaredMacroEvent;
use kafka_util::{InitialOffset, KafkaEventConsumer, Ungrouped};
use macro_event_broker::{EventConsumer as _, KafkaConsumerAdapter, MacroEvent as _};
use std::time::Duration;

/// Time allowed for topic metadata lookup.
const METADATA_TIMEOUT: Duration = Duration::from_secs(10);

/// One process's positioned Kafka consumer.
pub struct KafkaWebhookStreamConsumer {
    adapter: KafkaConsumerAdapter<Ungrouped, DeclaredMacroEvent>,
}

impl KafkaWebhookStreamConsumer {
    /// Connect and position every declared topic at its current end.
    pub async fn connect(brokers: String) -> Result<Self, rootcause::Report> {
        let adapter = tokio::task::spawn_blocking(move || {
            let consumer = KafkaEventConsumer::<Ungrouped>::from_env(&brokers)
                .map_err(|error| rootcause::report!(error))?;
            KafkaConsumerAdapter::<Ungrouped, DeclaredMacroEvent>::new(
                consumer,
                InitialOffset::Latest,
                METADATA_TIMEOUT,
            )
        })
        .await
        .map_err(|error| {
            rootcause::report!("webhook stream consumer setup task failed: {error}")
        })??;

        Ok(Self { adapter })
    }

    /// Consume forever, normalizing each record once into the shared sink.
    pub async fn run<S: WebhookStreamCandidateSink>(
        &self,
        sink: &S,
    ) -> Result<(), rootcause::Report> {
        loop {
            self.receive_and_publish(sink).await?;
        }
    }

    async fn receive_and_publish<S: WebhookStreamCandidateSink>(
        &self,
        sink: &S,
    ) -> Result<(), rootcause::Report> {
        let message = self.adapter.recv().await?;
        let decoded = match message.decode_payload() {
            Ok(decoded) => decoded,
            // Poison records must not wedge the process-level stream consumer.
            Err(error) => {
                tracing::warn!(error = ?error, "skipping undecodable broker event");
                return Ok(());
            }
        };
        match candidate_from(&decoded) {
            Ok(Some(candidate)) => sink.publish(candidate),
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(error = ?error, "skipping non-streamable broker event");
            }
        }
        Ok(())
    }
}

/// Normalize one decoded broker event into a stream candidate.
///
/// `None` means the event shape is deliberately not exposed to subscribers,
/// mirroring webhook ingestion's normalization.
fn candidate_from(
    decoded: &DeclaredMacroEvent,
) -> Result<Option<StreamCandidateEvent>, WebhookEventIngestionError> {
    match decoded {
        DeclaredMacroEvent::DocumentMacroEvent(event) => document_stream_candidate(event.event()),
        DeclaredMacroEvent::ChannelMacroEvent(event) => {
            channel_stream_candidate(event.event()).map(Some)
        }
        DeclaredMacroEvent::WebhookMacroEvent(event) => {
            webhook_stream_candidate(event.event()).map(Some)
        }
        DeclaredMacroEvent::AgentSessionMacroEvent(event) => {
            agent_trigger_stream_candidate(event.event()).map(Some)
        }
    }
}
