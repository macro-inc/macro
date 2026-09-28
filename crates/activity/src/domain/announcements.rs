//! Recipient policy and bounded best-effort activity delivery.

#[cfg(test)]
mod test;

use futures::{StreamExt as _, stream};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use std::{
    collections::{BTreeSet, HashMap},
    time::Duration,
};

use super::{
    events::{ActivityTopicEvent, ActivityWireRow},
    models::{Action, Activity},
    ports::{ActivityAudienceExpander, ActivityEventPublisher, ActivityRealtimePublisher},
};

/// Realtime must not hold up materialization while a broker or audience lookup
/// is unavailable. Clients refetch on reconnect to recover missed delivery.
const ANNOUNCEMENT_BUDGET: Duration = Duration::from_secs(5);
const MAX_CONCURRENT_DELIVERIES: usize = 16;

/// Expands entity audiences, deduplicates recipients, and announces committed rows.
pub struct ActivityAnnouncements<P, A> {
    publisher: P,
    audience: A,
}

impl<P: ActivityEventPublisher, A: ActivityAudienceExpander> ActivityAnnouncements<P, A> {
    /// Creates an announcer over transport and current-access ports.
    pub fn new(publisher: P, audience: A) -> Self {
        Self {
            publisher,
            audience,
        }
    }

    async fn recipients(&self, rows: &[(EntityType, &str, &str)]) -> Vec<BTreeSet<String>> {
        let mut audiences = HashMap::new();
        let mut recipients = Vec::with_capacity(rows.len());
        for &(kind, id, subject) in rows {
            if let std::collections::hash_map::Entry::Vacant(entry) = audiences.entry((kind, id)) {
                let users = match self.audience.entity_audience(kind, id).await {
                    Ok(users) => users,
                    Err(error) => {
                        tracing::warn!(?error, entity_type = ?kind, entity_id = id, "activity audience lookup failed");
                        Vec::new()
                    }
                };
                entry.insert(users);
            }
            let mut row_recipients: BTreeSet<String> = audiences[&(kind, id)]
                .iter()
                .map(|user| user.as_ref().to_owned())
                .collect();
            // Project moves can originate in a project the subject has never seen.
            // Its identifier must remain private, including after access is revoked.
            // Other domains retain their existing subject-feed behavior.
            if let Ok(viewer) = MacroUserIdStr::parse_from_str(subject) {
                let allowed = kind != EntityType::Initiative
                    || row_recipients.contains(subject)
                    || self
                        .audience
                        .viewer_can_see(kind, id, &viewer)
                        .await
                        .unwrap_or(false);
                if allowed {
                    row_recipients.insert(subject.to_owned());
                }
            }
            recipients.push(row_recipients);
        }
        recipients
    }

    async fn deliver(&self, events: Vec<ActivityTopicEvent>) {
        stream::iter(events)
            .for_each_concurrent(MAX_CONCURRENT_DELIVERIES, |event| async move {
                if let Err(error) = self.publisher.publish(event).await {
                    tracing::warn!(?error, "activity announcement failed");
                }
            })
            .await;
    }

    async fn bounded(&self, delivery: impl Future<Output = ()>) {
        if tokio::time::timeout(ANNOUNCEMENT_BUDGET, delivery)
            .await
            .is_err()
        {
            tracing::warn!("activity announcement exceeded delivery budget");
        }
    }
}

impl<P: ActivityEventPublisher, A: ActivityAudienceExpander> ActivityRealtimePublisher
    for ActivityAnnouncements<P, A>
{
    async fn publish_recorded(&self, activities: &[Activity]) {
        self.bounded(async {
            let keys: Vec<_> = activities
                .iter()
                .map(|a| (a.entity_type, a.entity_id.as_str(), a.subject_id.as_str()))
                .collect();
            let recipients = self.recipients(&keys).await;
            let mut task_audiences = HashMap::<String, BTreeSet<String>>::new();
            let mut deliveries: HashMap<String, Vec<ActivityWireRow>> = HashMap::new();
            for (activity, users) in activities.iter().zip(recipients) {
                let task_id = match &activity.action {
                    Action::TaskAdded(change) | Action::TaskRemoved(change) => {
                        Some(&change.task_id)
                    }
                    _ => None,
                };
                if let Some(task_id) = task_id
                    && !task_audiences.contains_key(task_id)
                {
                    let audience = self
                        .audience
                        .entity_audience(EntityType::Document, task_id)
                        .await;
                    let allowed = match audience {
                        Ok(users) => users.into_iter().map(|user| user.to_string()).collect(),
                        Err(error) => {
                            tracing::warn!(?error, "task activity audience lookup failed");
                            BTreeSet::new()
                        }
                    };
                    task_audiences.insert(task_id.clone(), allowed);
                }
                let row = ActivityWireRow::from_activity(activity);
                for user in users {
                    // A project grant alone never reveals an associated task. Public-link
                    // viewers recover through authorized history reads on refetch.
                    if let Some(task_id) = task_id
                        && !task_audiences[task_id].contains(&user)
                    {
                        continue;
                    }
                    deliveries.entry(user).or_default().push(row.clone());
                }
            }
            self.deliver(
                deliveries
                    .into_iter()
                    .map(|(recipient_id, activities)| ActivityTopicEvent::Recorded {
                        recipient_id,
                        activities,
                    })
                    .collect(),
            )
            .await;
        })
        .await;
    }

    async fn publish_invalidated(&self) {
        self.bounded(self.deliver(vec![ActivityTopicEvent::Invalidated]))
            .await;
    }
}
