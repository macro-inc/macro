//! Process-level Kafka consumer feeding the local webhook stream channel.
//!
//! Alongside the events it sends the feed a heartbeat every
//! [`STREAM_HEARTBEAT_INTERVAL`], but only while the consumer is making
//! progress by its librdkafka statistics ([`kafka_util::progress`]): polled
//! within the last 30 s, every partition's broker connected, and each
//! partition caught up or advancing. A consumer that hangs, loses its
//! brokers, or stops advancing stops the heartbeats, and clients reconnect.

use crate::domain::ingestion::{
    WebhookEventIngestionError,
    stream::{
        agent_session_lifecycle_stream_candidate, agent_trigger_stream_candidate,
        call_stream_candidate, channel_stream_candidate, document_stream_candidate,
        message_stream_candidate, password_stream_candidate, user_stream_candidate,
        webhook_stream_candidate,
    },
    user_event_subject,
};
use crate::domain::models::STREAM_HEARTBEAT_INTERVAL;
use crate::domain::ports::WebhookWorkspaceResolver;
use crate::domain::stream::{StreamCandidateEvent, StreamFeed};
use crate::topics::DeclaredMacroEvent;
use kafka_util::progress::{Progress, ProgressSample, assess};
use kafka_util::{ConsumerStatistics, InitialOffset, KafkaEventConsumer, Ungrouped};
use macro_event_broker::{KafkaConsumerAdapter, MacroEvent as _, MacroEventConsumerService};
use std::convert::Infallible;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::watch;
use tokio::time::MissedTickBehavior;

#[cfg(test)]
mod test;

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
    feed: &StreamFeed,
    workspace_resolver: &R,
) -> Result<(), rootcause::Report> {
    let (observer, progress) = ProgressCheck::start();
    let consumer = KafkaEventConsumer::<Ungrouped>::from_env_with_statistics(brokers, observer)
        .map_err(|error| rootcause::report!(error))?;
    let consumer =
        WebhookStreamKafkaAdapter::new(consumer, InitialOffset::Latest, METADATA_TIMEOUT)?;
    let consumer = WebhookStreamKafkaConsumer::new(consumer);

    // One task, so heartbeats stop with the consumer; the check, not the
    // shared task, decides whether it is progressing.
    tokio::select! {
        result = consume(&consumer, feed, workspace_resolver) => result,
        never = send_heartbeats(progress, feed) => match never {},
    }
}

async fn consume<R: WebhookWorkspaceResolver>(
    consumer: &WebhookStreamKafkaConsumer,
    feed: &StreamFeed,
    workspace_resolver: &R,
) -> Result<(), rootcause::Report> {
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
            Ok(Some(candidate)) => feed.publish(candidate),
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(error = ?error, "skipping non-streamable broker event");
            }
        }
    }
}

/// Judges the consumer's progress from the statistics samples it delivers.
struct ProgressCheck {
    samples: watch::Receiver<Option<Arc<ProgressSample>>>,
    /// The sample the previous check judged, to see partitions advance.
    previous: Option<Arc<ProgressSample>>,
    latest: Option<Arc<ProgressSample>>,
}

impl ProgressCheck {
    /// A check, and the statistics observer that feeds it.
    fn start() -> (ConsumerStatistics, Self) {
        let (sender, samples) = watch::channel(None);
        let observer: ConsumerStatistics = Arc::new(move |stats| {
            sender.send_replace(Some(Arc::new(ProgressSample::new(stats, Instant::now()))));
        });
        (observer, Self::new(samples))
    }

    fn new(samples: watch::Receiver<Option<Arc<ProgressSample>>>) -> Self {
        Self {
            samples,
            previous: None,
            latest: None,
        }
    }

    fn check(&mut self) -> Progress {
        if self.samples.has_changed().unwrap_or(false) {
            self.previous = self.latest.take();
            self.latest = self.samples.borrow_and_update().clone();
        }
        assess(
            self.previous.as_deref(),
            self.latest.as_deref(),
            Instant::now(),
            chrono::Utc::now().timestamp(),
        )
    }
}

/// Heartbeat the feed every interval in which the consumer is progressing.
async fn send_heartbeats(progress: ProgressCheck, feed: &StreamFeed) -> Infallible {
    let mut heartbeat = Heartbeat::new(progress);
    let mut ticks = tokio::time::interval(STREAM_HEARTBEAT_INTERVAL);
    ticks.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        ticks.tick().await;
        heartbeat.beat(feed);
    }
}

/// One heartbeat decision per interval, logging each change in progress.
struct Heartbeat {
    progress: ProgressCheck,
    last: Option<Progress>,
}

impl Heartbeat {
    fn new(progress: ProgressCheck) -> Self {
        Self {
            progress,
            last: None,
        }
    }

    /// Heartbeat `feed` if the consumer is progressing.
    fn beat(&mut self, feed: &StreamFeed) -> Progress {
        let current = self.progress.check();
        if current == Progress::Progressing {
            feed.heartbeat();
        }
        if self.last != Some(current) {
            if self.last == Some(Progress::Progressing) {
                tracing::warn!(
                    progress = current.as_ref(),
                    "webhook stream consumer stopped progressing; heartbeats paused"
                );
            } else {
                tracing::info!(
                    progress = current.as_ref(),
                    "webhook stream consumer progress changed"
                );
            }
            self.last = Some(current);
        }
        current
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
        DeclaredMacroEvent::PasswordMacroEvent(event) => {
            password_stream_candidate(event.event()).map(Some)
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
