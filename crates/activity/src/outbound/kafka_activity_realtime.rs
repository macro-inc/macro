//! Kafka adapter announcing recorded activities to realtime subscribers.

#[cfg(test)]
mod test;

use std::collections::{BTreeSet, HashMap};

use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use rootcause::prelude::{Report, ResultExt as _};

use crate::domain::events::{ActivityMacroEvent, ActivityWireRow};
use crate::domain::models::Activity;
use crate::domain::ports::{ActivityAudienceExpander, ActivityRealtimePublisher};

/// Kafka-backed activity realtime publisher.
///
/// Resolves each row's recipients — the acting subject plus everyone with
/// current access to the touched entity — and publishes one
/// `activity.recorded` event per recipient on the `macro.activity` topic,
/// keyed by the recipient so one user's updates preserve publish order
/// across partitions.
pub struct KafkaActivityRealtimePublisher<B, X> {
    broker: B,
    audience: X,
}

impl<B, X> KafkaActivityRealtimePublisher<B, X> {
    /// Creates an activity realtime publisher backed by `broker`, widening
    /// delivery to each touched entity's current accessors via `audience`.
    pub fn new(broker: B, audience: X) -> Self {
        Self { broker, audience }
    }
}

impl<B: MacroEventBroker, X: ActivityAudienceExpander> KafkaActivityRealtimePublisher<B, X> {
    async fn publish_for_recipient(
        &self,
        recipient_id: &str,
        activities: Vec<ActivityWireRow>,
    ) -> Result<(), Report> {
        let event = ActivityMacroEvent::recorded(recipient_id, activities);
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

    /// Resolves each distinct touched entity's audience once per batch.
    /// A failed expansion degrades that entity to subject-only delivery —
    /// consistent with the port's best-effort contract.
    async fn entity_audiences<'a>(
        &self,
        activities: &'a [Activity],
    ) -> HashMap<(EntityType, &'a str), Vec<MacroUserIdStr<'static>>> {
        let mut audiences = HashMap::new();
        for activity in activities {
            let key = (activity.entity_type, activity.entity_id.as_str());
            if audiences.contains_key(&key) {
                continue;
            }
            let audience = match self
                .audience
                .entity_audience(activity.entity_type, &activity.entity_id)
                .await
            {
                Ok(users) => users,
                Err(error) => {
                    tracing::error!(
                        error = ?error,
                        entity_type = ?activity.entity_type,
                        entity_id = %activity.entity_id,
                        "failed to expand activity audience; delivering to the subject only"
                    );
                    Vec::new()
                }
            };
            audiences.insert(key, audience);
        }
        audiences
    }
}

impl<B: MacroEventBroker, X: ActivityAudienceExpander> ActivityRealtimePublisher
    for KafkaActivityRealtimePublisher<B, X>
{
    #[tracing::instrument(skip_all, fields(topic = "macro.activity", rows = activities.len()))]
    async fn publish_recorded(&self, activities: &[Activity]) {
        let audiences = self.entity_audiences(activities).await;

        let mut by_recipient: HashMap<String, Vec<ActivityWireRow>> = HashMap::new();
        for activity in activities {
            let mut recipients = BTreeSet::new();
            // The acting subject always hears about their own action — their
            // feed shows it even where entity access has since lapsed. Bot
            // subjects have no subscription to address.
            if MacroUserIdStr::parse_from_str(&activity.subject_id).is_ok() {
                recipients.insert(activity.subject_id.clone());
            }
            if let Some(audience) =
                audiences.get(&(activity.entity_type, activity.entity_id.as_str()))
            {
                for user in audience {
                    recipients.insert(user.as_ref().to_owned());
                }
            }
            let row = ActivityWireRow::from_activity(activity);
            for recipient in recipients {
                by_recipient.entry(recipient).or_default().push(row.clone());
            }
        }

        // Best-effort by contract: a lost announcement is recovered by the
        // source event replaying or the client's next fetch, so failures are
        // logged, never propagated into the materializing write path.
        for (recipient_id, rows) in by_recipient {
            if let Err(error) = self.publish_for_recipient(&recipient_id, rows).await {
                tracing::error!(error = ?error, "failed to announce recorded activities");
            }
        }
    }
}
