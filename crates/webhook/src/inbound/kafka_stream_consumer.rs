//! Process-level Kafka consumer feeding the local webhook stream channel.

use crate::domain::ingestion::{
    WebhookEventIngestionError,
    stream::{
        agent_trigger_stream_candidate, channel_stream_candidate, document_stream_candidate,
        webhook_stream_candidate,
    },
};
use crate::domain::stream::StreamCandidateEvent;
use crate::topics::DeclaredMacroEvent;
use kafka_util::{InitialOffset, KafkaEventConsumer, Ungrouped};
use macro_event_broker::{KafkaConsumerAdapter, MacroEvent as _, MacroEventConsumerService};
use std::time::Duration;
use tokio::sync::broadcast;

/// Time allowed for topic metadata lookup.
const METADATA_TIMEOUT: Duration = Duration::from_secs(10);

type WebhookStreamKafkaAdapter = KafkaConsumerAdapter<Ungrouped, DeclaredMacroEvent>;
type WebhookStreamKafkaConsumer =
    MacroEventConsumerService<DeclaredMacroEvent, WebhookStreamKafkaAdapter>;

/// Consume broker events from now onward and publish normalized stream candidates.
pub async fn run_webhook_stream_consumer(
    brokers: &str,
    sender: &broadcast::Sender<StreamCandidateEvent>,
) -> Result<(), rootcause::Report> {
    let consumer = KafkaEventConsumer::<Ungrouped>::from_env(brokers)
        .map_err(|error| rootcause::report!(error))?;
    let consumer =
        WebhookStreamKafkaAdapter::new(consumer, InitialOffset::Latest, METADATA_TIMEOUT)?;
    let consumer = WebhookStreamKafkaConsumer::new(consumer);

    loop {
        let message = consumer.recv().await?;
        let decoded = match message.decode_payload() {
            Ok(decoded) => decoded,
            // Poison records must not wedge the process-level stream consumer.
            Err(error) => {
                tracing::warn!(error = ?error, "skipping undecodable broker event");
                continue;
            }
        };
        match candidate_from(&decoded) {
            Ok(Some(candidate)) => {
                // Having no active subscribers is expected; SSE delivery is best-effort.
                let _ = sender.send(candidate);
            }
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(error = ?error, "skipping non-streamable broker event");
            }
        }
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
