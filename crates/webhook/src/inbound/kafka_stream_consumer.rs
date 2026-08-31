//! Process-level Kafka consumer feeding the local webhook stream hub.

use crate::domain::ingestion::{
    WebhookEventIngestionError, agent_trigger_stream_candidate, channel_stream_candidate,
    document_stream_candidate, webhook_stream_candidate,
};
use crate::domain::stream::{MAX_REPLAY_WINDOW, StreamCandidateEvent, WebhookStreamCandidateSink};
use crate::topics::DeclaredMacroEvent;
use kafka_util::{AssignedPartitionRange, InitialOffset, KafkaEventConsumer, Ungrouped};
use macro_event_broker::{EventConsumer as _, KafkaConsumerAdapter, MacroEvent as _};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

/// Time allowed for topic metadata and offset-for-timestamp lookups.
const METADATA_TIMEOUT: Duration = Duration::from_secs(10);
/// Poll interval while waiting for Kafka's startup snapshot high watermarks.
const BOOTSTRAP_POSITION_INTERVAL: Duration = Duration::from_millis(100);
/// How often the manual assignment checks for newly added Kafka partitions.
const ASSIGNMENT_REFRESH_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// One process's positioned Kafka consumer.
pub struct KafkaWebhookStreamConsumer {
    adapter: Arc<KafkaConsumerAdapter<Ungrouped, DeclaredMacroEvent>>,
    assignment: Vec<AssignedPartitionRange>,
}

impl KafkaWebhookStreamConsumer {
    /// Connect and seek every declared topic to the start of the replay window.
    pub async fn connect(brokers: String) -> Result<Self, rootcause::Report> {
        let replay_window_ms = i64::try_from(MAX_REPLAY_WINDOW.as_millis()).unwrap_or(i64::MAX);
        let available_since_ms = chrono::Utc::now()
            .timestamp_millis()
            .saturating_sub(replay_window_ms);
        let initial_offset = InitialOffset::AtTimestampMs(available_since_ms);
        let (adapter, assignment) = tokio::task::spawn_blocking(move || {
            let consumer = KafkaEventConsumer::<Ungrouped>::from_env(&brokers)
                .map_err(|error| rootcause::report!(error))?;
            KafkaConsumerAdapter::<Ungrouped, DeclaredMacroEvent>::new_with_assignment(
                consumer,
                initial_offset,
                METADATA_TIMEOUT,
            )
        })
        .await
        .map_err(|error| {
            rootcause::report!("webhook stream consumer setup task failed: {error}")
        })??;

        Ok(Self {
            adapter: Arc::new(adapter),
            assignment,
        })
    }

    /// Consume through the partition high watermarks captured at connection.
    pub async fn bootstrap<S: WebhookStreamCandidateSink>(
        &self,
        sink: &S,
    ) -> Result<(), rootcause::Report> {
        self.bootstrap_ranges(sink, &self.assignment).await
    }

    async fn bootstrap_ranges<S: WebhookStreamCandidateSink>(
        &self,
        sink: &S,
        ranges: &[AssignedPartitionRange],
    ) -> Result<(), rootcause::Report> {
        let mut remaining: HashMap<(String, i32), i64> = ranges
            .iter()
            .filter(|range| range.start_offset < range.end_offset)
            .map(|range| ((range.topic.clone(), range.partition), range.end_offset))
            .collect();

        while !remaining.is_empty() {
            if let Ok(result) =
                tokio::time::timeout(BOOTSTRAP_POSITION_INTERVAL, self.receive_and_publish(sink))
                    .await
            {
                result?;
            }
            for position in self.adapter.assigned_partition_positions()? {
                if remaining
                    .get(&(position.topic.clone(), position.partition))
                    .is_some_and(|end_offset| {
                        position
                            .next_offset
                            .is_some_and(|next_offset| next_offset >= *end_offset)
                    })
                {
                    remaining.remove(&(position.topic, position.partition));
                }
            }
        }
        Ok(())
    }

    /// Consume forever, normalizing each record once into the shared sink.
    pub async fn run<S: WebhookStreamCandidateSink>(
        &self,
        sink: &S,
    ) -> Result<(), rootcause::Report> {
        let mut refresh = tokio::time::interval(ASSIGNMENT_REFRESH_INTERVAL);
        refresh.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        refresh.tick().await;
        loop {
            tokio::select! {
                result = self.receive_and_publish(sink) => result?,
                _ = refresh.tick() => {
                    let replay_window_ms =
                        i64::try_from(MAX_REPLAY_WINDOW.as_millis()).unwrap_or(i64::MAX);
                    let initial_offset = InitialOffset::AtTimestampMs(
                        chrono::Utc::now()
                            .timestamp_millis()
                            .saturating_sub(replay_window_ms),
                    );
                    sink.begin_loading();
                    let adapter = Arc::clone(&self.adapter);
                    let ranges = tokio::task::spawn_blocking(move || {
                        adapter.refresh_topics_with_watermarks(
                            initial_offset,
                            METADATA_TIMEOUT,
                        )
                    })
                    .await
                    .map_err(|error| {
                        rootcause::report!(
                            "webhook stream partition refresh task failed: {error}"
                        )
                    })??;
                    if !ranges.is_empty() {
                        tracing::info!(
                            partition_count = ranges.len(),
                            "loading newly discovered webhook SSE Kafka partitions"
                        );
                        self.bootstrap_ranges(sink, &ranges).await?;
                    }
                    sink.mark_ready();
                }
            }
        }
    }

    async fn receive_and_publish<S: WebhookStreamCandidateSink>(
        &self,
        sink: &S,
    ) -> Result<(), rootcause::Report> {
        let message = self.adapter.recv().await?;
        let decoded = match message.decode_payload() {
            Ok(decoded) => decoded,
            // Poison records still advance bootstrap progress and must not wedge
            // the process-level stream consumer.
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
