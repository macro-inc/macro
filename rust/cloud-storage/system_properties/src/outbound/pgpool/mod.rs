//! PostgreSQL implementation for system properties repository.

#[cfg(test)]
mod test;

use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::domain::{
    model::{PropertyRow, SystemPropertyError, SystemPropertyKey},
    port::SystemPropertiesRepository,
};
use macro_uuid::generate_uuid_v7;

/// PostgreSQL implementation of SystemPropertiesRepository.
#[derive(Clone)]
pub struct PgSystemPropertiesRepository {
    pool: Pool<Postgres>,
}

impl PgSystemPropertiesRepository {
    /// Create a new PgSystemPropertiesRepository.
    pub fn new(pool: Pool<Postgres>) -> Self {
        Self { pool }
    }
}

impl SystemPropertiesRepository for PgSystemPropertiesRepository {
    async fn bulk_upsert_properties(
        &self,
        rows: Vec<PropertyRow>,
    ) -> Result<(), SystemPropertyError> {
        if rows.is_empty() {
            return Ok(());
        }

        let ids: Vec<Uuid> = rows.iter().map(|_| generate_uuid_v7()).collect();
        let entity_ids: Vec<&str> = rows.iter().map(|r| r.entity_id()).collect();
        let entity_types: Vec<String> = rows
            .iter()
            .map(|r| {
                serde_json::to_value(r.entity_type())
                    .expect("EntityType serializes to JSON")
                    .as_str()
                    .expect("EntityType serializes to string")
                    .to_string()
            })
            .collect();
        let property_ids: Vec<Uuid> = rows.iter().map(|r| r.property_definition_id()).collect();
        let values: Vec<serde_json::Value> = rows.iter().map(|r| r.values().clone()).collect();

        sqlx::query!(
            r#"
            INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
            SELECT 
                u.id,
                u.entity_id,
                u.entity_type::property_entity_type,
                u.property_definition_id,
                u.values
            FROM UNNEST(
                $1::UUID[],
                $2::TEXT[],
                $3::TEXT[],
                $4::UUID[],
                $5::JSONB[]
            ) AS u(id, entity_id, entity_type, property_definition_id, values)
            ON CONFLICT (entity_id, entity_type, property_definition_id)
            DO UPDATE SET 
                values = EXCLUDED.values,
                updated_at = NOW()
            "#,
            &ids,
            &entity_ids as &[&str],
            &entity_types,
            &property_ids,
            &values,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn copy_task_properties(
        &self,
        from_task_id: &str,
        to_task_id: &str,
    ) -> Result<(), SystemPropertyError> {
        let system_task_property_ids: Vec<Uuid> = vec![
            SystemPropertyKey::Assignees.uuid(),
            SystemPropertyKey::Status.uuid(),
            SystemPropertyKey::Priority.uuid(),
            SystemPropertyKey::DueDate.uuid(),
            SystemPropertyKey::ParentTask.uuid(),
            SystemPropertyKey::Subtasks.uuid(),
            SystemPropertyKey::DependsOn.uuid(),
            SystemPropertyKey::Effort.uuid(),
            SystemPropertyKey::StoryPoints.uuid(),
            SystemPropertyKey::RelevantDocuments.uuid(),
        ];

        // Step 1: Fetch all properties from source task
        let source_properties = sqlx::query!(
            r#"
            SELECT property_definition_id, values
            FROM entity_properties
            WHERE entity_id = $1
              AND entity_type = 'TASK'
            "#,
            from_task_id
        )
        .fetch_all(&self.pool)
        .await?;

        // Step 2: Copy all properties to destination task (with v7 UUIDs)
        if !source_properties.is_empty() {
            let ids: Vec<Uuid> = source_properties
                .iter()
                .map(|_| generate_uuid_v7())
                .collect();
            let entity_ids: Vec<&str> = source_properties.iter().map(|_| to_task_id).collect();
            let property_ids: Vec<Uuid> = source_properties
                .iter()
                .map(|r| r.property_definition_id)
                .collect();
            let values: Vec<serde_json::Value> = source_properties
                .iter()
                .map(|r| r.values.clone().unwrap_or(serde_json::Value::Null))
                .collect();

            sqlx::query!(
                r#"
                INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
                SELECT 
                    u.id,
                    u.entity_id,
                    'TASK'::property_entity_type,
                    u.property_definition_id,
                    u.values
                FROM UNNEST(
                    $1::UUID[],
                    $2::TEXT[],
                    $3::UUID[],
                    $4::JSONB[]
                ) AS u(id, entity_id, property_definition_id, values)
                ON CONFLICT (entity_id, entity_type, property_definition_id)
                DO UPDATE SET 
                    values = EXCLUDED.values,
                    updated_at = NOW()
                "#,
                &ids,
                &entity_ids as &[&str],
                &property_ids,
                &values,
            )
            .execute(&self.pool)
            .await?;
        }

        // Step 3: Ensure all system task properties exist (insert with null if missing)
        let ids: Vec<Uuid> = system_task_property_ids
            .iter()
            .map(|_| generate_uuid_v7())
            .collect();
        let entity_ids: Vec<&str> = system_task_property_ids
            .iter()
            .map(|_| to_task_id)
            .collect();

        sqlx::query!(
            r#"
            INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
            SELECT 
                u.id,
                u.entity_id,
                'TASK'::property_entity_type,
                u.property_definition_id,
                NULL
            FROM UNNEST(
                $1::UUID[],
                $2::TEXT[],
                $3::UUID[]
            ) AS u(id, entity_id, property_definition_id)
            ON CONFLICT (entity_id, entity_type, property_definition_id)
            DO NOTHING
            "#,
            &ids,
            &entity_ids as &[&str],
            &system_task_property_ids,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
