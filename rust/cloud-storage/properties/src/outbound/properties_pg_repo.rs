//! PostgreSQL implementation for properties repository.

use anyhow::Context;
use models_properties::EntityType;
use models_properties::service::property_value::PropertyValue;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::domain::ports::PropertiesRepo;

/// PostgreSQL implementation of PropertiesRepo.
#[derive(Debug, Clone)]
pub struct PropertiesPgRepo {
    pool: Pool<Postgres>,
}

impl PropertiesPgRepo {
    /// Create a new PropertiesPgRepo.
    pub fn new(pool: Pool<Postgres>) -> Self {
        Self { pool }
    }
}

impl PropertiesRepo for PropertiesPgRepo {
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self, value))]
    async fn update_entity_property_value_if_exists(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
        value: Option<PropertyValue>,
    ) -> Result<(), Self::Err> {
        // Serialize PropertyValue to JSONB (or NULL if None)
        let value_json = match value {
            Some(v) => serde_json::to_value(&v).context("failed to serialize property value")?,
            None => serde_json::Value::Null,
        };

        tracing::debug!(value_json = ?value_json, "updating entity property if exists");

        // Atomic update - only updates if the property is already attached
        let result = sqlx::query!(
            r#"
            UPDATE entity_properties
            SET values = $4, updated_at = NOW()
            WHERE entity_id = $1
              AND entity_type = $2
              AND property_definition_id = $3
            "#,
            entity_id,
            entity_type as EntityType,
            property_definition_id,
            value_json
        )
        .execute(&self.pool)
        .await
        .context("failed to update entity property")?;

        if result.rows_affected() > 0 {
            tracing::info!("successfully updated entity property");
        } else {
            tracing::debug!("entity property not attached, no-op");
        }

        Ok(())
    }
}
