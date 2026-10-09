//! Activity-owned keyset reads for mixed timelines.
use super::PgActivityRepo;
use crate::domain::timeline::{
    ActivityTimeline, ActivityTimelineQuery, TimelineActivity, TimelineReadError,
};

impl ActivityTimeline for PgActivityRepo {
    fn read<'a>(
        &'a self,
        query: ActivityTimelineQuery,
    ) -> std::pin::Pin<
        Box<dyn Future<Output = Result<Vec<TimelineActivity>, TimelineReadError>> + Send + 'a>,
    > {
        Box::pin(async move {
            // Keep cursor predicates separate from the first-page queries so
            // generic prepared plans seek into the keyset index instead of
            // scanning and filtering everything on the other side of it. The
            // property filter only narrows `property_changed` seeks, inside the
            // limit, so callers' lookahead stays exact. The NOT IN list repeats
            // the partial index predicate (UNINDEXED_TIMELINE_ACTIONS) so the
            // planner can prove the index applies.
            let actions = query.selection.action_tags();
            let properties = query.selection.property_ids();
            let rows = match (query.newer, query.cursor) {
                (true, None) => {
                    sqlx::query_as!(
                        TimelineActivity,
                        r#"
                        SELECT event.id AS "id!", event.actor_id AS "actor_id!",
                               event.occurred_at AS "occurred_at!", event.action AS "action!", event.payload
                        FROM unnest($3::text[]) selected(action)
                        CROSS JOIN LATERAL (
                            SELECT id, actor_id, occurred_at, action, action_payload AS payload
                            FROM activity_events
                            WHERE entity_type = $1 AND entity_id = $2 AND action = selected.action
                              AND action NOT IN ('messaged', 'opened', 'edited', 'sent')
                              AND (selected.action <> 'property_changed' OR cardinality($4::text[]) = 0
                                   OR action_payload->>'property' = ANY($4::text[]))
                            ORDER BY occurred_at ASC, id ASC LIMIT $5
                        ) event
                        ORDER BY event.occurred_at ASC, event.id ASC LIMIT $5
                    "#,
                        query.entity_type.as_ref(),
                        query.entity_id,
                        &actions as &[&str],
                        &properties,
                        i64::from(query.limit)
                    )
                    .fetch_all(&self.pool)
                    .await?
                }
                (true, Some((cursor_at, cursor_id))) => {
                    sqlx::query_as!(
                        TimelineActivity,
                        r#"
                        SELECT event.id AS "id!", event.actor_id AS "actor_id!",
                               event.occurred_at AS "occurred_at!", event.action AS "action!", event.payload
                        FROM unnest($3::text[]) selected(action)
                        CROSS JOIN LATERAL (
                            SELECT id, actor_id, occurred_at, action, action_payload AS payload
                            FROM activity_events
                            WHERE entity_type = $1 AND entity_id = $2 AND action = selected.action
                              AND action NOT IN ('messaged', 'opened', 'edited', 'sent')
                              AND (selected.action <> 'property_changed' OR cardinality($4::text[]) = 0
                                   OR action_payload->>'property' = ANY($4::text[]))
                              AND (occurred_at, id) > ($5, $6)
                            ORDER BY occurred_at ASC, id ASC LIMIT $7
                        ) event
                        ORDER BY event.occurred_at ASC, event.id ASC LIMIT $7
                    "#,
                        query.entity_type.as_ref(),
                        query.entity_id,
                        &actions as &[&str],
                        &properties,
                        cursor_at,
                        cursor_id,
                        i64::from(query.limit)
                    )
                    .fetch_all(&self.pool)
                    .await?
                }
                (false, None) => {
                    sqlx::query_as!(
                        TimelineActivity,
                        r#"
                        SELECT event.id AS "id!", event.actor_id AS "actor_id!",
                               event.occurred_at AS "occurred_at!", event.action AS "action!", event.payload
                        FROM unnest($3::text[]) selected(action)
                        CROSS JOIN LATERAL (
                            SELECT id, actor_id, occurred_at, action, action_payload AS payload
                            FROM activity_events
                            WHERE entity_type = $1 AND entity_id = $2 AND action = selected.action
                              AND action NOT IN ('messaged', 'opened', 'edited', 'sent')
                              AND (selected.action <> 'property_changed' OR cardinality($4::text[]) = 0
                                   OR action_payload->>'property' = ANY($4::text[]))
                            ORDER BY occurred_at DESC, id DESC LIMIT $5
                        ) event
                        ORDER BY event.occurred_at DESC, event.id DESC LIMIT $5
                    "#,
                        query.entity_type.as_ref(),
                        query.entity_id,
                        &actions as &[&str],
                        &properties,
                        i64::from(query.limit)
                    )
                    .fetch_all(&self.pool)
                    .await?
                }
                (false, Some((cursor_at, cursor_id))) => {
                    sqlx::query_as!(
                        TimelineActivity,
                        r#"
                        SELECT event.id AS "id!", event.actor_id AS "actor_id!",
                               event.occurred_at AS "occurred_at!", event.action AS "action!", event.payload
                        FROM unnest($3::text[]) selected(action)
                        CROSS JOIN LATERAL (
                            SELECT id, actor_id, occurred_at, action, action_payload AS payload
                            FROM activity_events
                            WHERE entity_type = $1 AND entity_id = $2 AND action = selected.action
                              AND action NOT IN ('messaged', 'opened', 'edited', 'sent')
                              AND (selected.action <> 'property_changed' OR cardinality($4::text[]) = 0
                                   OR action_payload->>'property' = ANY($4::text[]))
                              AND (occurred_at, id) < ($5, $6)
                            ORDER BY occurred_at DESC, id DESC LIMIT $7
                        ) event
                        ORDER BY event.occurred_at DESC, event.id DESC LIMIT $7
                    "#,
                        query.entity_type.as_ref(),
                        query.entity_id,
                        &actions as &[&str],
                        &properties,
                        cursor_at,
                        cursor_id,
                        i64::from(query.limit)
                    )
                    .fetch_all(&self.pool)
                    .await?
                }
            };
            Ok(rows)
        })
    }
}
