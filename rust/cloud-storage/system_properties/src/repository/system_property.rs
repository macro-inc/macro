//! System properties repository types and helpers.

use models_properties::EntityType;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::error::SystemPropertyError;

pub(crate) type Result<T> = std::result::Result<T, SystemPropertyError>;

/// A single property row to upsert.
#[derive(Debug)]
pub(crate) struct PropertyRow {
    pub entity_id: String,
    pub entity_type: EntityType,
    pub property_definition_id: Uuid,
    pub values: serde_json::Value,
}

/// Repository for system property database operations.
#[derive(Clone)]
pub struct SystemProperties {
    pub(crate) db: Pool<Postgres>,
}

impl SystemProperties {
    /// Create a new SystemProperties repository.
    pub fn new(db: Pool<Postgres>) -> Self {
        Self { db }
    }

    /// Bulk upsert property rows in a single query.
    pub(crate) async fn bulk_upsert_properties(&self, rows: &[PropertyRow]) -> Result<()> {
        if rows.is_empty() {
            return Ok(());
        }

        let ids: Vec<Uuid> = rows.iter().map(|_| Uuid::now_v7()).collect();
        let entity_ids: Vec<&str> = rows.iter().map(|r| r.entity_id.as_str()).collect();
        let entity_types: Vec<String> = rows
            .iter()
            .map(|r| {
                serde_json::to_value(r.entity_type)
                    .expect("EntityType serializes to JSON")
                    .as_str()
                    .expect("EntityType serializes to string")
                    .to_string()
            })
            .collect();
        let property_ids: Vec<Uuid> = rows.iter().map(|r| r.property_definition_id).collect();
        let values: Vec<serde_json::Value> = rows.iter().map(|r| r.values.clone()).collect();

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
        .execute(&self.db)
        .await?;

        Ok(())
    }
}
