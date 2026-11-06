//! Session-correlated history; session visibility is enforced by its caller.
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
        // Bound each invocation's index scan before merging the session page.
        let mut rows = sqlx::query_as!(
            StoredRow,
            r#"SELECT e.id, e.agent_correlation_id, e.agent_verb, e.actor_id, e.action,
                      e.action_payload, e.subject_id, e.entity_type, e.entity_id, e.occurred_at
               FROM agent_correlations c
               CROSS JOIN LATERAL (
                   SELECT id, agent_correlation_id, agent_verb, actor_id, action, action_payload,
                          subject_id, entity_type, entity_id, occurred_at
                   FROM activity_events
                   WHERE agent_correlation_id = c.id
                     AND (occurred_at, id) < (COALESCE($3::timestamptz, 'infinity'), COALESCE($4::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'))
                   ORDER BY occurred_at DESC, id DESC LIMIT $5
               ) e
               WHERE c.agent_session_id = $1 AND ($2::uuid IS NULL OR c.id = $2)
               ORDER BY e.occurred_at DESC, e.id DESC LIMIT $5"#,
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
