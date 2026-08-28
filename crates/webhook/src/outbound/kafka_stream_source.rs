//! Per-stream ungrouped Kafka source for live webhook event streaming.
//!
//! Every open stream owns its own manually-assigned, ungrouped consumer, so a
//! slow subscriber only stalls its own consumer (lag accumulates in Kafka;
//! nothing is dropped and no other stream is affected). The consumer joins no
//! durable group and commits nothing: the subscriber's resume cursor is the
//! last event id it saw, presented on reconnect.

use crate::domain::ingestion::{
    WebhookEventIngestionError, normalized_agent_trigger_event, normalized_channel_event,
    normalized_document_event, normalized_webhook_event,
};
use crate::domain::stream::{
    StreamAudience, StreamCandidateEvent, StreamStart, WebhookStreamSource,
    WebhookStreamSourceFactory,
};
use crate::topics::DeclaredMacroEvent;
use entity_access::domain::models::EntityType;
use kafka_util::{InitialOffset, KafkaEventConsumer, Ungrouped};
use macro_event_broker::{EventConsumer as _, KafkaConsumerAdapter, MacroEvent as _};
use std::sync::Arc;
use std::time::Duration;

/// Time allowed for topic metadata and offset-for-timestamp lookups while
/// positioning a new stream's consumer.
const METADATA_TIMEOUT: Duration = Duration::from_secs(10);

/// Factory that opens one ungrouped Kafka consumer per stream.
#[derive(Clone)]
pub struct KafkaWebhookStreamSourceFactory {
    brokers: Arc<str>,
}

impl KafkaWebhookStreamSourceFactory {
    /// Create a factory connecting to `brokers`.
    pub fn new(brokers: &str) -> Self {
        Self {
            brokers: Arc::from(brokers),
        }
    }
}

impl WebhookStreamSourceFactory for KafkaWebhookStreamSourceFactory {
    type Source = KafkaWebhookStreamSource;

    async fn open(&self, start: StreamStart) -> Result<Self::Source, rootcause::Report> {
        let brokers = self.brokers.clone();
        // Consumer positioning does synchronous broker metadata and offset
        // lookups; keep them off the async runtime.
        let initial_offset = match start {
            StreamStart::Latest => InitialOffset::Latest,
            StreamStart::AtTimestampMs(timestamp_ms) => InitialOffset::AtTimestampMs(timestamp_ms),
        };
        let adapter = tokio::task::spawn_blocking(move || {
            let consumer = KafkaEventConsumer::<Ungrouped>::from_env(&brokers)
                .map_err(|error| rootcause::report!(error))?;
            KafkaConsumerAdapter::<Ungrouped, DeclaredMacroEvent>::new(
                consumer,
                initial_offset,
                METADATA_TIMEOUT,
            )
        })
        .await
        .map_err(|error| rootcause::report!("stream source open task failed: {error}"))??;

        Ok(KafkaWebhookStreamSource { adapter })
    }
}

/// One stream's positioned Kafka consumer.
pub struct KafkaWebhookStreamSource {
    adapter: KafkaConsumerAdapter<Ungrouped, DeclaredMacroEvent>,
}

impl WebhookStreamSource for KafkaWebhookStreamSource {
    async fn next_event(&mut self) -> Result<StreamCandidateEvent, rootcause::Report> {
        loop {
            let message = self.adapter.recv().await?;
            let decoded = match message.decode_payload() {
                Ok(decoded) => decoded,
                // A poison record must not wedge the stream; the durable
                // webhook consumer logs and skips these identically.
                Err(error) => {
                    tracing::warn!(error = ?error, "skipping undecodable broker event");
                    continue;
                }
            };
            match candidate_from(&decoded) {
                Ok(Some(candidate)) => return Ok(candidate),
                Ok(None) => continue,
                Err(error) => {
                    tracing::warn!(error = ?error, "skipping non-streamable broker event");
                    continue;
                }
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
        DeclaredMacroEvent::DocumentMacroEvent(event) => Ok(normalized_document_event(
            event.event(),
        )?
        .map(|normalized| StreamCandidateEvent {
            audience: StreamAudience::Entity {
                entity_id: normalized.entity_id.clone(),
                entity_type: EntityType::Document,
            },
            event: normalized,
        })),
        DeclaredMacroEvent::ChannelMacroEvent(event) => {
            let normalized = normalized_channel_event(event.event())?;
            Ok(Some(StreamCandidateEvent {
                audience: StreamAudience::Entity {
                    entity_id: normalized.entity_id.clone(),
                    entity_type: EntityType::Channel,
                },
                event: normalized,
            }))
        }
        DeclaredMacroEvent::WebhookMacroEvent(event) => {
            let (normalized, workspace_id) = normalized_webhook_event(event.event())?;
            Ok(Some(StreamCandidateEvent {
                audience: StreamAudience::Workspace { workspace_id },
                event: normalized,
            }))
        }
        DeclaredMacroEvent::AgentSessionMacroEvent(event) => {
            let (normalized, audience) = normalized_agent_trigger_event(event.event())?;
            Ok(Some(StreamCandidateEvent {
                audience: StreamAudience::Entity {
                    entity_id: audience.entity_id,
                    entity_type: audience.entity_type,
                },
                event: normalized,
            }))
        }
    }
}
