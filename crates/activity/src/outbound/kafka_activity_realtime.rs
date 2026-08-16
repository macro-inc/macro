//! Kafka adapter announcing recorded activities to realtime subscribers.

use std::collections::HashMap;

use macro_event_broker::MacroEventBroker;
use rootcause::prelude::{Report, ResultExt as _};

use crate::domain::events::{ActivityMacroEvent, ActivityWireRow};
use crate::domain::models::Activity;
use crate::domain::ports::ActivityRealtimePublisher;

/// Kafka-backed activity realtime publisher.
///
/// Publishes one `activity.recorded` event per distinct subject on the
/// `macro.activity` topic, keyed by the subject so one user's updates
/// preserve publish order across partitions.
pub struct KafkaActivityRealtimePublisher<B> {
    broker: B,
}

impl<B> KafkaActivityRealtimePublisher<B> {
    /// Creates an activity realtime publisher backed by `broker`.
    pub fn new(broker: B) -> Self {
        Self { broker }
    }
}

impl<B: MacroEventBroker> KafkaActivityRealtimePublisher<B> {
    async fn publish_for_subject(
        &self,
        subject_id: &str,
        activities: Vec<ActivityWireRow>,
    ) -> Result<(), Report> {
        let event = ActivityMacroEvent::recorded(subject_id, activities);
        let publish = self
            .broker
            .send_event(&event)
            .context("failed to dispatch recorded-activity Kafka event")?;
        publish
            .await
            .context("recorded-activity Kafka publish task failed")?
            .context("failed to publish recorded activities to Kafka")?;
        Ok(())
    }
}

impl<B: MacroEventBroker> ActivityRealtimePublisher for KafkaActivityRealtimePublisher<B> {
    #[tracing::instrument(skip_all, fields(topic = "macro.activity", rows = activities.len()))]
    async fn publish_recorded(&self, activities: &[Activity]) {
        let mut by_subject: HashMap<&str, Vec<ActivityWireRow>> = HashMap::new();
        for activity in activities {
            by_subject
                .entry(activity.subject_id.as_str())
                .or_default()
                .push(ActivityWireRow::from_activity(activity));
        }

        // Best-effort by contract: a lost announcement is recovered by the
        // source event replaying or the client's next fetch, so failures are
        // logged, never propagated into the materializing write path.
        for (subject_id, rows) in by_subject {
            if let Err(error) = self.publish_for_subject(subject_id, rows).await {
                tracing::error!(error = ?error, "failed to announce recorded activities");
            }
        }
    }
}
