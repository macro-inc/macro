//! Activity-owned keyset reads for mixed timelines.
use super::PgActivityRepo;
use crate::domain::timeline::{
    ActivityTimeline, ActivityTimelineLookup, ActivityTimelineQuery, TimelineActivity,
    TimelineReadError,
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

    fn read_by_ids<'a>(
        &'a self,
        lookup: ActivityTimelineLookup,
    ) -> std::pin::Pin<
        Box<dyn Future<Output = Result<Vec<TimelineActivity>, TimelineReadError>> + Send + 'a>,
    > {
        Box::pin(async move {
            let actions = lookup.selection.action_tags();
            let properties = lookup.selection.property_ids();
            // Each id is one primary-key probe. The `OFFSET 0` keeps the
            // parent and selection out of the probe, so no plan can answer
            // from the parent's range of the entity index instead; they only
            // filter the rows found.
            let rows = sqlx::query_as!(
                TimelineActivity,
                r#"
                SELECT event.id AS "id!", event.actor_id AS "actor_id!", event.occurred_at AS "occurred_at!",
                       event.action AS "action!", event.action_payload AS payload
                FROM unnest($1::uuid[]) named(id)
                CROSS JOIN LATERAL (
                    SELECT found.id, found.actor_id, found.occurred_at, found.action,
                           found.action_payload, found.entity_type, found.entity_id
                    FROM activity_events found
                    WHERE found.id = named.id
                    OFFSET 0
                ) event
                WHERE event.entity_type = $2 AND event.entity_id = $3
                  AND event.action = ANY($4::text[])
                  AND (event.action <> 'property_changed' OR cardinality($5::text[]) = 0
                       OR event.action_payload->>'property' = ANY($5::text[]))
                ORDER BY event.occurred_at ASC, event.id ASC
                "#,
                &lookup.ids,
                lookup.entity_type.as_ref(),
                lookup.entity_id,
                &actions as &[&str],
                &properties,
            )
            .fetch_all(&self.pool)
            .await?;
            Ok(rows)
        })
    }
}
