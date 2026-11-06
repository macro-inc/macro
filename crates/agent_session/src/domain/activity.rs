//! Session-view-authorized activity, without narrowing to affected-entity access.
use super::error::AgentSessionError;
use activity::domain::ports::AgentActivityReads;
use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use serde::{Deserialize, Serialize};
use std::num::NonZeroU32;
use uuid::Uuid;

/// Stable chronological resume position.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentActivityCursor {
    /// Last stored event time.
    pub occurred_at: DateTime<Utc>,
    /// Tie-breaking activity identity.
    pub id: Uuid,
}

/// One page of the activity caused by this session.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentActivityPage {
    /// Original activity rows, also retained in the affected entities' histories.
    pub activities: Vec<activity::ActivityWireRow>,
    /// Resume position, present when more raw rows remain.
    pub next_cursor: Option<AgentActivityCursor>,
}

/// Read using the session capability, never permission on the affected entities.
pub async fn read<R: AgentActivityReads>(
    repository: &R,
    access: &EntityAccessReceipt<ViewAccessLevel>,
    correlation_id: Option<Uuid>,
    cursor: Option<AgentActivityCursor>,
    limit: NonZeroU32,
) -> Result<AgentActivityPage, AgentSessionError> {
    let session_id = Uuid::parse_str(&access.entity().entity_id)
        .map_err(|error| AgentSessionError::Unknown(error.into()))?;
    let page = repository
        .agent_activity(
            session_id,
            correlation_id,
            cursor.map(|c| (c.occurred_at, c.id)),
            limit,
        )
        .await
        .map_err(|error| AgentSessionError::Unknown(error.into()))?;
    Ok(AgentActivityPage {
        activities: page
            .records
            .into_iter()
            .map(activity::ActivityWireRow::from)
            .collect(),
        next_cursor: page
            .next
            .map(|(occurred_at, id)| AgentActivityCursor { occurred_at, id }),
    })
}
