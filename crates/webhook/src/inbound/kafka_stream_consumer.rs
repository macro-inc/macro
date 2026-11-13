//! Process-level Kafka consumer feeding the local webhook stream channel.

use crate::domain::ingestion::{WebhookEventIngestionError, stream::stream_candidate};
use crate::domain::ports::WebhookWorkspaceResolver;
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
///
/// `workspace_resolver` expands `TeamsOf` audiences (a user event's subject)
/// into team workspaces, once per event rather than once per subscriber.
pub async fn run_webhook_stream_consumer<R: WebhookWorkspaceResolver>(
    brokers: &str,
    sender: &broadcast::Sender<StreamCandidateEvent>,
    workspace_resolver: &R,
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
        match candidate_from(&decoded, workspace_resolver).await {
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
/// `None` means the event is deliberately not exposed to subscribers,
/// mirroring webhook ingestion's normalization.
async fn candidate_from<R: WebhookWorkspaceResolver>(
    decoded: &DeclaredMacroEvent,
    workspace_resolver: &R,
) -> Result<Option<StreamCandidateEvent>, WebhookEventIngestionError> {
    match decoded {
        DeclaredMacroEvent::DocumentMacroEvent(event) => {
            stream_candidate(event.event(), workspace_resolver).await
        }
        DeclaredMacroEvent::ChannelMacroEvent(event) => {
            stream_candidate(event.event(), workspace_resolver).await
        }
        DeclaredMacroEvent::CallNotificationMacroEvent(event) => {
            stream_candidate(event.event(), workspace_resolver).await
        }
        DeclaredMacroEvent::MessageMacroEvent(event) => {
            stream_candidate(event.event(), workspace_resolver).await
        }
        DeclaredMacroEvent::WebhookMacroEvent(event) => {
            stream_candidate(event.event(), workspace_resolver).await
        }
        DeclaredMacroEvent::AgentSessionMacroEvent(event) => {
            stream_candidate(event.event(), workspace_resolver).await
        }
        DeclaredMacroEvent::AgentSessionLifecycleMacroEvent(event) => {
            stream_candidate(event.event(), workspace_resolver).await
        }
        DeclaredMacroEvent::UserMacroEvent(event) => {
            stream_candidate(event.event(), workspace_resolver).await
        }
    }
}
