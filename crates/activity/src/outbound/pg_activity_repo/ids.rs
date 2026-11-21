//! Identity reads remain scoped to the owning domain's selected timeline.

use super::PgActivityRepo;
use crate::domain::timeline::{ActivityTimelineIdsQuery, TimelineActivity, TimelineReadError};

#[cfg(test)]
mod test;

impl PgActivityRepo {
    #[tracing::instrument(name = "activity.read_timeline_ids", skip_all, fields(entity_type = %query.entity_type, entity_id = %query.entity_id, activity_count = query.ids.len() as i64), err)]
    pub(super) async fn read_timeline_ids(
        &self,
        query: ActivityTimelineIdsQuery,
    ) -> Result<Vec<TimelineActivity>, TimelineReadError> {
        if query.ids.len() > 200 {
            return Err("too many timeline activity ids".into());
        }
        if query.ids.is_empty() {
            return Ok(Vec::new());
        }
        let actions = query.selection.action_tags();
        let properties = query.selection.property_ids();
        Ok(sqlx::query_as!(
            TimelineActivity,
            r#"
            SELECT id, actor_id, occurred_at, action, action_payload AS payload
            FROM activity_events
            WHERE id = ANY($1) AND entity_type = $2 AND entity_id = $3
                AND action = ANY($4)
                AND (action <> 'property_changed' OR cardinality($5::text[]) = 0
                    OR action_payload->>'property' = ANY($5::text[]))
            ORDER BY array_position($1, id)
            "#,
            &query.ids,
            query.entity_type.as_ref(),
            query.entity_id,
            &actions as &[&str],
            &properties,
        )
        .fetch_all(&self.pool)
        .await?)
    }
}
