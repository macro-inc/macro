//! PostgreSQL implementation for system properties repository.

use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::domain::{
    model::{PropertyRow, SystemPropertyError},
    port::SystemPropertiesRepository,
};

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

        let ids: Vec<Uuid> = rows.iter().map(|_| Uuid::now_v7()).collect();
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

        sqlx::query(
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
        )
        .bind(&ids)
        .bind(&entity_ids)
        .bind(&entity_types)
        .bind(&property_ids)
        .bind(&values)
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
