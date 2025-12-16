//! PostgreSQL implementation for properties repository.

use models_properties::EntityType;
use models_properties::service::property_value::PropertyValue;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::{entity_property_queries, task_property_queries};
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
        entity_property_queries::update_entity_property_value_if_exists(
            &self.pool,
            entity_id,
            entity_type,
            property_definition_id,
            value,
        )
        .await
    }

    #[tracing::instrument(skip(self))]
    async fn link_parent_task(
        &self,
        task_id: Uuid,
        parent_task_id: Option<Uuid>,
    ) -> Result<(), Self::Err> {
        task_property_queries::link_parent_task(&self.pool, task_id, parent_task_id).await
    }

    #[tracing::instrument(skip(self))]
    async fn link_subtasks(&self, task_id: Uuid, subtask_ids: Vec<Uuid>) -> Result<(), Self::Err> {
        task_property_queries::link_subtasks(&self.pool, task_id, subtask_ids).await
    }

    #[tracing::instrument(skip(self))]
    async fn get_entity_property_value(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
    ) -> Result<Option<PropertyValue>, Self::Err> {
        let row = sqlx::query!(
            r#"
            SELECT values as "values: serde_json::Value"
            FROM entity_properties
            WHERE entity_id = $1
              AND entity_type = $2
              AND property_definition_id = $3
            "#,
            entity_id,
            entity_type as EntityType,
            property_definition_id
        )
        .fetch_optional(&self.pool)
        .await?;

        match row {
            None => Ok(None),
            Some(r) => match r.values {
                None => Ok(None),
                Some(json_value) if json_value.is_null() => Ok(None),
                Some(json_value) => {
                    let value: PropertyValue = serde_json::from_value(json_value)?;
                    Ok(Some(value))
                }
            },
        }
    }
}
