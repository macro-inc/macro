use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// Progress/terminal state of a backfill job for [`RefreshEmailEvent::Backfill`].
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BackfillStatus {
    /// A batch of threads landed; more may follow.
    Progress,
    /// All threads for the job have been processed.
    Complete,
    /// The job terminated before finishing.
    Failed,
}

/// Payload for the `refresh_email` connection gateway event: identifies the
/// inbox that changed and the kind of change.
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum RefreshEmailEvent {
    /// Backfill progress for `link_id`; see [`BackfillStatus`].
    Backfill {
        link_id: Uuid,
        status: BackfillStatus,
    },
    /// A message was inserted or updated for `link_id`.
    UpsertMessage { link_id: Uuid },
    /// Labels changed for `link_id`.
    UpdateLabels { link_id: Uuid },
    /// A message was deleted for `link_id`.
    DeleteMessage { link_id: Uuid },
}
