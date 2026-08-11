//! Postgres adapter for the `activity_events` table (MacroDB).

#[cfg(test)]
mod test;

use std::collections::HashMap;
use std::num::NonZeroU32;
use std::str::FromStr;

use chrono::{DateTime, Utc};
use model_entity::EntityType;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::{
    models::{ActionDecodeError, Activity, ActivityRecord, Actor, RecordedAction},
    ports::{ActivityFeedPage, ActivityReads, ActivityRepo, EntityActivityMap},
};

/// Writes activities to MacroDB.
#[derive(Debug, Clone)]
pub struct PgActivityRepo {
    pool: PgPool,
}

impl PgActivityRepo {
    /// Builds the adapter over a MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl ActivityRepo for PgActivityRepo {
    type Err = sqlx::Error;

    async fn insert_activities(&self, activities: &[Activity]) -> Result<(), Self::Err> {
        if activities.is_empty() {
            return Ok(());
        }

        let mut ids = Vec::with_capacity(activities.len());
        let mut actor_ids = Vec::with_capacity(activities.len());
        let mut subject_ids = Vec::with_capacity(activities.len());
        let mut actions = Vec::with_capacity(activities.len());
        let mut payloads = Vec::with_capacity(activities.len());
        let mut entity_types = Vec::with_capacity(activities.len());
        let mut entity_ids = Vec::with_capacity(activities.len());
        let mut occurred_ats = Vec::with_capacity(activities.len());
        for activity in activities {
            let (action, payload) = activity.action.to_columns();
            ids.push(activity.id);
            actor_ids.push(activity.actor.as_ref().to_owned());
            subject_ids.push(activity.subject_id.clone());
            actions.push(action.to_owned());
            payloads.push(payload);
            entity_types.push(activity.entity_type.as_ref().to_owned());
            entity_ids.push(activity.entity_id.clone());
            occurred_ats.push(activity.occurred_at);
        }

        sqlx::query!(
            r#"
            INSERT INTO activity_events
                (id, actor_id, subject_id, action, action_payload,
                 entity_type, entity_id, occurred_at)
            SELECT * FROM UNNEST(
                $1::uuid[], $2::text[], $3::text[], $4::text[], $5::jsonb[],
                $6::text[], $7::text[], $8::timestamptz[])
            ON CONFLICT (id) DO NOTHING
            "#,
            &ids,
            &actor_ids,
            &subject_ids,
            &actions,
            payloads.as_slice() as &[Option<serde_json::Value>],
            &entity_types,
            &entity_ids,
            &occurred_ats,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn purge_entities(&self, entities: &[(EntityType, String)]) -> Result<(), Self::Err> {
        if entities.is_empty() {
            return Ok(());
        }

        let entity_types: Vec<String> = entities
            .iter()
            .map(|(entity_type, _)| entity_type.as_ref().to_owned())
            .collect();
        let entity_ids: Vec<String> = entities.iter().map(|(_, id)| id.clone()).collect();

        sqlx::query!(
            r#"
            DELETE FROM activity_events
            WHERE (entity_type, entity_id) IN
                (SELECT * FROM UNNEST($1::text[], $2::text[]))
            "#,
            &entity_types,
            &entity_ids,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

/// One `activity_events` row as fetched, before decoding.
struct StoredRow {
    id: Uuid,
    actor_id: String,
    action: String,
    action_payload: Option<serde_json::Value>,
    subject_id: String,
    entity_type: String,
    entity_id: String,
    occurred_at: DateTime<Utc>,
}

impl StoredRow {
    /// Decodes the raw row, forward-tolerantly for the action and
    /// skip-with-warn for corruption the model can't represent: one bad row
    /// must not fail a whole page.
    fn decode(self) -> Option<ActivityRecord> {
        let entity_type = EntityType::from_str(&self.entity_type)
            .inspect_err(|error| {
                tracing::warn!(
                    activity_id = %self.id,
                    entity_type = %self.entity_type,
                    ?error,
                    "skipping activity row with unknown entity type"
                );
            })
            .ok()?;
        let actor = Actor::try_from(self.actor_id)
            .inspect_err(|error| {
                tracing::warn!(
                    activity_id = %self.id,
                    ?error,
                    "skipping activity row with unparseable actor"
                );
            })
            .ok()?;
        let (action, decode_error) = RecordedAction::from_columns(self.action, self.action_payload);
        // An unknown tag is expected during rollouts (newer writer); a known
        // tag that won't decode is corruption or a payload shape change.
        if let Some(error) = decode_error
            && !matches!(error, ActionDecodeError::UnknownTag)
        {
            tracing::warn!(
                activity_id = %self.id,
                ?error,
                "known action tag with undecodable payload"
            );
        }
        Some(ActivityRecord {
            id: self.id,
            actor,
            subject_id: self.subject_id,
            entity_type,
            entity_id: self.entity_id,
            action,
            occurred_at: self.occurred_at,
        })
    }
}

impl ActivityReads for PgActivityRepo {
    type Err = sqlx::Error;

    async fn subject_feed(
        &self,
        subject_id: &str,
        cursor: Option<(DateTime<Utc>, Uuid)>,
        limit: NonZeroU32,
    ) -> Result<ActivityFeedPage, Self::Err> {
        // One extra raw row as the has-more probe. The page boundary and the
        // next cursor come from the raw rows, before decoding: a corrupt row
        // shrinks the visible page but never ends pagination.
        let limit = limit.get();
        let fetch = i64::from(limit) + 1;
        // Two static queries instead of one `$x IS NULL OR …` merge, which
        // would defeat the (subject_id, occurred_at DESC, id DESC) index.
        let mut rows = match cursor {
            None => {
                sqlx::query_as!(
                    StoredRow,
                    r#"
                    SELECT id, actor_id, action, action_payload,
                           subject_id, entity_type, entity_id, occurred_at
                    FROM activity_events
                    WHERE subject_id = $1
                    ORDER BY occurred_at DESC, id DESC
                    LIMIT $2
                    "#,
                    subject_id,
                    fetch,
                )
                .fetch_all(&self.pool)
                .await?
            }
            Some((cursor_at, cursor_id)) => {
                sqlx::query_as!(
                    StoredRow,
                    r#"
                    SELECT id, actor_id, action, action_payload,
                           subject_id, entity_type, entity_id, occurred_at
                    FROM activity_events
                    WHERE subject_id = $1 AND (occurred_at, id) < ($2, $3)
                    ORDER BY occurred_at DESC, id DESC
                    LIMIT $4
                    "#,
                    subject_id,
                    cursor_at,
                    cursor_id,
                    fetch,
                )
                .fetch_all(&self.pool)
                .await?
            }
        };

        let has_more = rows.len() > limit as usize;
        rows.truncate(limit as usize);
        let next = has_more
            .then(|| rows.last().map(|row| (row.occurred_at, row.id)))
            .flatten();
        Ok(ActivityFeedPage {
            records: rows.into_iter().filter_map(StoredRow::decode).collect(),
            next,
        })
    }

    async fn entity_activity(
        &self,
        keys: &[(EntityType, String)],
        per_entity_limit: u32,
    ) -> Result<EntityActivityMap, Self::Err> {
        if keys.is_empty() {
            return Ok(HashMap::new());
        }

        let entity_types: Vec<String> = keys
            .iter()
            .map(|(entity_type, _)| entity_type.as_ref().to_owned())
            .collect();
        let entity_ids: Vec<String> = keys.iter().map(|(_, id)| id.clone()).collect();

        // One lateral scan of the (entity_type, entity_id, occurred_at DESC,
        // id DESC) index per requested entity, in a single round trip.
        let rows = sqlx::query_as!(
            StoredRow,
            r#"
            SELECT a.id AS "id!", a.actor_id AS "actor_id!",
                   a.action AS "action!", a.action_payload,
                   a.subject_id AS "subject_id!",
                   a.entity_type AS "entity_type!", a.entity_id AS "entity_id!",
                   a.occurred_at AS "occurred_at!"
            FROM UNNEST($1::text[], $2::text[]) AS k(entity_type, entity_id)
            JOIN LATERAL (
                SELECT * FROM activity_events e
                WHERE e.entity_type = k.entity_type AND e.entity_id = k.entity_id
                ORDER BY e.occurred_at DESC, e.id DESC
                LIMIT $3
            ) a ON TRUE
            ORDER BY a.occurred_at DESC, a.id DESC
            "#,
            &entity_types,
            &entity_ids,
            i64::from(per_entity_limit),
        )
        .fetch_all(&self.pool)
        .await?;

        let mut by_entity = EntityActivityMap::new();
        for row in rows {
            let Some(record) = row.decode() else { continue };
            by_entity
                .entry((record.entity_type, record.entity_id.clone()))
                .or_default()
                .push(record);
        }
        Ok(by_entity)
    }
}
