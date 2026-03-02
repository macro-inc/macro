//! PostgreSQL implementation for properties repository.

use models_properties::EntityType;
use models_properties::service::property_value::PropertyValue;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::{entity_property_queries, property_definition_queries, task_property_queries};
use crate::domain::ports::PropertiesRepo;
use models_properties::service::property_definition::PropertyDefinition;

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

    #[tracing::instrument(skip(self))]
    async fn get_property_definition(
        &self,
        property_definition_id: Uuid,
    ) -> Result<Option<PropertyDefinition>, Self::Err> {
        property_definition_queries::get_property_definition(&self.pool, property_definition_id)
            .await
    }

    #[tracing::instrument(skip(self))]
    async fn count_valid_property_options(
        &self,
        property_definition_id: Uuid,
        option_ids: &[Uuid],
    ) -> Result<i64, Self::Err> {
        entity_property_queries::count_valid_property_options(
            &self.pool,
            property_definition_id,
            option_ids,
        )
        .await
    }

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

    #[tracing::instrument(skip(self, value))]
    async fn upsert_entity_property(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
        value: Option<PropertyValue>,
    ) -> Result<(), Self::Err> {
        entity_property_queries::upsert_entity_property(
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

    #[tracing::instrument(skip(self))]
    async fn get_document_name(&self, id: &str) -> Result<Option<String>, Self::Err> {
        // Tasks are stored as documents, so this works for both documents and tasks
        match macro_db_client::document::get_document_name(&self.pool, id).await {
            Ok(name) => Ok(Some(name)),
            Err(e) => {
                // If document doesn't exist, return None instead of error
                if let Some(db_err) = e.downcast_ref::<sqlx::Error>()
                    && matches!(db_err, sqlx::Error::RowNotFound)
                {
                    return Ok(None);
                }
                Err(e)
            }
        }
    }

    #[tracing::instrument(skip(self))]
    async fn get_user_profile_picture(&self, user_id: &str) -> Result<Option<String>, Self::Err> {
        let pics = macro_db_client::user::update_profile_picture::get_profile_pictures(
            &self.pool,
            &vec![user_id.to_string()],
        )
        .await?;
        Ok(pics.pictures.into_iter().next().map(|p| p.url))
    }
}
