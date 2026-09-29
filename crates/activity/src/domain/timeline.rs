//! Bounded activity reads for chronological timelines owned by other domains.
use std::{future::Future, pin::Pin};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::models::{Activity, EntityType};

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

/// Selection authorized by the owning timeline's domain service.
pub struct ActivityTimelineQuery {
    /// Parent kind.
    pub entity_type: EntityType,
    /// Parent identity.
    pub entity_id: String,
    /// Explicit action vocabulary chosen by the timeline owner.
    pub actions: &'static [&'static str],
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
