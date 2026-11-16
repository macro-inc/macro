//! A routine appearance write and its history policy.

use activity::{Activity, AppearanceUpdate, Attribution};
use chrono::{DateTime, Utc};
use macro_uuid::Uuid;
use model_entity::{EntityAppearance, EntityType};

/// An authorized appearance replacement, persisted together with its history.
pub struct ChangeAppearance {
    /// Routine identity.
    pub id: Uuid,
    /// Replacement overrides.
    pub appearance: EntityAppearance,
    /// Principal responsible for the change.
    pub attribution: Attribution,
    /// Stable identity for the history event of this write.
    pub event_id: Uuid,
    /// When the change was requested.
    pub occurred_at: DateTime<Utc>,
}

impl ChangeAppearance {
    /// Record actual stored transitions only; repeated writes have no history.
    pub fn activity(&self, previous: &EntityAppearance) -> Option<Activity> {
        AppearanceUpdate {
            appearance: self.appearance.clone(),
            attribution: Some(self.attribution.clone()),
            event_id: self.event_id,
            occurred_at: self.occurred_at,
        }
        .activity(EntityType::ScheduledAction, self.id.to_string(), previous)
    }
}
