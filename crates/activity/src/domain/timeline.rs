//! Bounded activity reads for chronological timelines owned by other domains.
use std::{future::Future, pin::Pin};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::models::{Action, ActionTag, Activity, EntityType};

#[cfg(test)]
mod test;

/// A displayable fact returned together with a message page.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct TimelineActivity {
    /// Stable activity identity, independent of message ids.
    pub id: Uuid,
    /// Principal who performed the action.
    pub actor_id: String,
    /// Immutable chronological position.
    pub occurred_at: DateTime<Utc>,
    /// Durable action tag. Unknown tags remain representable during rollouts.
    pub action: String,
    /// The action's stored payload.
    pub payload: Option<serde_json::Value>,
}

impl From<&Activity> for TimelineActivity {
    /// The same projection a timeline read returns for the stored row.
    fn from(activity: &Activity) -> Self {
        let (action, payload) = activity.action.to_columns();
        Self {
            id: activity.id,
            actor_id: activity.actor.as_ref().to_owned(),
            occurred_at: activity.occurred_at,
            action: action.to_owned(),
            payload,
        }
    }
}

/// High-volume actions the timeline index leaves out: every message, view,
/// content edit and email send records one, and timelines never show them.
/// Storage repeats this list in the index predicate and in every timeline
/// query; [`TimelineSelection::new`] refuses them so a selection can't name a
/// row the index skipped.
pub const UNINDEXED_TIMELINE_ACTIONS: &[ActionTag] = &[
    ActionTag::Messaged,
    ActionTag::Opened,
    ActionTag::Edited,
    ActionTag::Sent,
];

/// Which of an entity's activity a timeline shows. Reads apply it in storage
/// and live delivery applies [`Self::includes`]; both match the same rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimelineSelection {
    actions: &'static [ActionTag],
    properties: &'static [Uuid],
}

impl TimelineSelection {
    /// Show `actions`, with `property_changed` narrowed to `properties` (empty
    /// keeps every property). Fails to compile in a `const` when an action is
    /// in [`UNINDEXED_TIMELINE_ACTIONS`].
    pub const fn new(actions: &'static [ActionTag], properties: &'static [Uuid]) -> Self {
        let mut i = 0;
        while i < actions.len() {
            let mut j = 0;
            while j < UNINDEXED_TIMELINE_ACTIONS.len() {
                if actions[i] as usize == UNINDEXED_TIMELINE_ACTIONS[j] as usize {
                    panic!("timelines cannot show messaged, opened, edited or sent activity");
                }
                j += 1;
            }
            i += 1;
        }
        Self {
            actions,
            properties,
        }
    }

    /// Whether a recorded action belongs in the timeline.
    pub fn includes(&self, action: &Action) -> bool {
        self.actions.contains(&ActionTag::from(action))
            && match action {
                Action::PropertyChanged(change) => {
                    self.properties.is_empty()
                        || change
                            .property
                            .parse()
                            .is_ok_and(|property| self.properties.contains(&property))
                }
                _ => true,
            }
    }

    /// Stored action tags, as storage compares them.
    pub fn action_tags(&self) -> Vec<&'static str> {
        self.actions.iter().map(|&tag| tag.into()).collect()
    }

    /// Property definition ids, as stored in `property_changed` payloads.
    pub fn property_ids(&self) -> Vec<String> {
        self.properties.iter().map(Uuid::to_string).collect()
    }
}

/// Selection authorized by the owning timeline's domain service.
pub struct ActivityTimelineQuery {
    /// Parent kind.
    pub entity_type: EntityType,
    /// Parent identity.
    pub entity_id: String,
    /// The activity the timeline owner chose to show.
    pub selection: TimelineSelection,
    /// Exclusive timestamp and UUID boundary shared with messages.
    pub cursor: Option<(DateTime<Utc>, Uuid)>,
    /// Read forward from the boundary when true; backward otherwise.
    pub newer: bool,
    /// Maximum records to return, including the caller's lookahead.
    pub limit: u16,
}

/// Error returned by an activity timeline reader.
pub type TimelineReadError = Box<dyn std::error::Error + Send + Sync>;

/// Read activity facts without crossing another domain's storage boundary.
pub trait ActivityTimeline: Send + Sync + 'static {
    /// Return the nearest matching records on one side of the cursor.
    fn read<'a>(
        &'a self,
        query: ActivityTimelineQuery,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<TimelineActivity>, TimelineReadError>> + Send + 'a>>;
}
