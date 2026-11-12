//! Process-level Kafka consumer feeding the local webhook stream channel.

use crate::domain::ingestion::{
    WebhookEventIngestionError,
    stream::{
        agent_session_lifecycle_stream_candidate, agent_trigger_stream_candidate,
        call_stream_candidate, channel_stream_candidate, document_stream_candidate,
        message_stream_candidate, user_stream_candidate, webhook_stream_candidate,
    },
    user_event_subject,
};
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
/// `workspace_resolver` expands a user event's subject into their team
/// workspaces, once per event rather than once per subscriber.
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
/// `None` means the event shape is deliberately not exposed to subscribers,
/// mirroring webhook ingestion's normalization.
async fn candidate_from<R: WebhookWorkspaceResolver>(
    decoded: &DeclaredMacroEvent,
    workspace_resolver: &R,
) -> Result<Option<StreamCandidateEvent>, WebhookEventIngestionError> {
    match decoded {
        DeclaredMacroEvent::DocumentMacroEvent(event) => document_stream_candidate(event.event()),
        DeclaredMacroEvent::ChannelMacroEvent(event) => {
            channel_stream_candidate(event.event()).map(Some)
        }
        DeclaredMacroEvent::CallNotificationMacroEvent(event) => {
            call_stream_candidate(event.event()).map(Some)
        }
        DeclaredMacroEvent::MessageMacroEvent(event) => {
            message_stream_candidate(event.event()).map(Some)
        }
        DeclaredMacroEvent::WebhookMacroEvent(event) => {
            webhook_stream_candidate(event.event()).map(Some)
        }
        DeclaredMacroEvent::AgentSessionMacroEvent(event) => {
            agent_trigger_stream_candidate(event.event()).map(Some)
        }
        DeclaredMacroEvent::AgentSessionLifecycleMacroEvent(event) => {
            agent_session_lifecycle_stream_candidate(event.event()).map(Some)
        }
        DeclaredMacroEvent::UserMacroEvent(event) => {
            let user = user_event_subject(event.event());
            let team_workspace_ids = user_team_workspace_ids(workspace_resolver, user).await;
            user_stream_candidate(event.event(), team_workspace_ids).map(Some)
        }
    }
}

/// The user's team workspaces, excluding their personal workspace (the user id).
///
/// A resolution failure degrades to the user-and-contacts audience: SSE is
/// best-effort, and persisted webhooks still deliver durably.
#[tracing::instrument(name = "webhook.stream.resolve_user_teams", skip_all, fields(user_id = %user))]
async fn user_team_workspace_ids<R: WebhookWorkspaceResolver>(
    workspace_resolver: &R,
    user: macro_user_id::user_id::MacroUserIdStr<'static>,
) -> Vec<String> {
    let personal = user.as_ref().to_string();
    match workspace_resolver.resolve_workspace_ids(vec![user]).await {
        Ok(mut workspace_ids) => {
            workspace_ids.retain(|id| *id != personal);
            workspace_ids
        }
        Err(error) => {
            let error: anyhow::Error = error.into();
            tracing::warn!(error = ?error, "failed to resolve user team workspaces for stream");
            Vec::new()
        }
    }
}
