//! Postgres adapter for the `activity_events` table (MacroDB).

#[cfg(test)]
mod test;

use model_entity::EntityType;
use sqlx::PgPool;

use crate::domain::{models::Activity, ports::ActivityRepo};

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
