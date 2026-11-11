//! Session-correlated history; session visibility is enforced by its caller.
//! Read activity (`opened`) is left out: the session view lists what changed.
use super::{PgActivityRepo, StoredRow};
use crate::domain::ports::{ActivityFeedPage, AgentActivityReads};
use chrono::{DateTime, Utc};
use std::num::NonZeroU32;
use uuid::Uuid;

impl AgentActivityReads for PgActivityRepo {
    type Err = sqlx::Error;

    async fn agent_activity(
        &self,
        session_id: Uuid,
        correlation_id: Option<Uuid>,
        cursor: Option<(DateTime<Utc>, Uuid)>,
        limit: NonZeroU32,
    ) -> Result<ActivityFeedPage, Self::Err> {
        let (before_at, before_id) = cursor.unzip();
        let limit = limit.get() as usize;
        let fetch = limit as i64 + 1;
        // One scan of `activity_events_agent_session_idx`, which the trigger
        // fills from the correlation; `opened` rows are reads, never shown.
        let mut rows = sqlx::query_as!(
            StoredRow,
            r#"SELECT id, agent_correlation_id, agent_verb, actor_id, action, action_payload,
                      subject_id, entity_type, entity_id, occurred_at
               FROM activity_events
               WHERE agent_session_id = $1
                 AND action <> 'opened'
                 AND ($2::uuid IS NULL OR agent_correlation_id = $2)
                 AND (occurred_at, id) < (COALESCE($3::timestamptz, 'infinity'), COALESCE($4::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'))
               ORDER BY occurred_at DESC, id DESC
               LIMIT $5"#,
            session_id,
            correlation_id,
            before_at,
            before_id,
            fetch,
        )
        .fetch_all(&self.pool)
        .await?;
        let more = rows.len() > limit;
        rows.truncate(limit);
        let next = more
            .then(|| rows.last().map(|row| (row.occurred_at, row.id)))
            .flatten();
        Ok(ActivityFeedPage {
            records: rows.into_iter().filter_map(StoredRow::decode).collect(),
            next,
        })
    }
}
