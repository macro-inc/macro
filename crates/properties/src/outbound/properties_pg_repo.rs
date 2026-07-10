//! PostgreSQL implementation for properties repository.

use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_value::PropertyValue;
use models_properties::{EntityReference, EntityType};
use sqlx::{Pool, Postgres};
use std::collections::HashMap;
use uuid::Uuid;

use super::{
    entity_properties_get_query, entity_property_queries, metadata_queries,
    property_definition_queries, property_option_queries, task_property_queries,
};
use crate::domain::model::{
    EntityPropertiesKey, EntityPropertyInfo, PropertyDefinitionOwner, UpdatePropertyOptionOutcome,
};
use crate::domain::ports::PropertiesRepo;
use models_properties::DataType;
use models_properties::EntityPropertyReference;
use models_properties::service::document_metadata::DocumentMetadata;
use models_properties::service::project_metadata::ProjectMetadata;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::service::thread_metadata::ThreadMetadata;

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

fn regroup_entity_properties(
    entity_refs: &[EntityReference],
    properties_by_entity_id: HashMap<String, Vec<EntityPropertyWithDefinition>>,
) -> HashMap<EntityPropertiesKey, Vec<EntityPropertyWithDefinition>> {
    let mut result = entity_refs
        .iter()
        .map(|entity_ref| (EntityPropertiesKey::from(entity_ref), Vec::new()))
        .collect::<HashMap<_, _>>();

    for property in properties_by_entity_id.into_values().flatten() {
        let key = EntityPropertiesKey {
            entity_id: property.property.entity_id.clone(),
            entity_type: property.property.entity_type,
        };
        result.entry(key).or_default().push(property);
    }

    result
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
    async fn get_property_definition_with_owner(
        &self,
        property_definition_id: Uuid,
        user_id: &MacroUserIdStr<'_>,
        team_id: Option<Uuid>,
    ) -> Result<Option<PropertyDefinition>, Self::Err> {
        property_definition_queries::get_property_definition_with_owner(
            &self.pool,
            property_definition_id,
            user_id,
            team_id,
        )
        .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_property_definitions(
        &self,
        team_id: Option<Uuid>,
        user_id: Option<&MacroUserIdStr<'_>>,
        include_system: bool,
    ) -> Result<Vec<PropertyDefinition>, Self::Err> {
        property_definition_queries::list_property_definitions(
            &self.pool,
            team_id,
            user_id,
            include_system,
        )
        .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_property_definitions_with_options(
        &self,
        team_id: Option<Uuid>,
        user_id: Option<&MacroUserIdStr<'_>>,
        include_system: bool,
    ) -> Result<Vec<PropertyDefinitionWithOptions>, Self::Err> {
        property_definition_queries::list_property_definitions_with_options(
            &self.pool,
            team_id,
            user_id,
            include_system,
        )
        .await
    }

    #[tracing::instrument(skip(self, options), err)]
    async fn create_property_definition(
        &self,
        owner: PropertyDefinitionOwner<'_>,
        display_name: &str,
        data_type: DataType,
        is_multi_select: bool,
        specific_entity_type: Option<EntityType>,
        options: Vec<PropertyOption>,
    ) -> Result<PropertyDefinition, Self::Err> {
        property_definition_queries::create_property_definition(
            &self.pool,
            owner,
            display_name,
            data_type,
            is_multi_select,
            specific_entity_type,
            options,
        )
        .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_property_definition(
        &self,
        property_definition_id: Uuid,
    ) -> Result<(), Self::Err> {
        property_definition_queries::delete_property_definition(&self.pool, property_definition_id)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_property_option(
        &self,
        option_id: Uuid,
    ) -> Result<Option<PropertyOption>, Self::Err> {
        property_option_queries::get_property_option(&self.pool, option_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_property_options(
        &self,
        property_definition_id: Uuid,
    ) -> Result<Vec<PropertyOption>, Self::Err> {
        property_option_queries::get_property_options(&self.pool, property_definition_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn create_property_option(
        &self,
        property_definition_id: Uuid,
        display_order: i32,
        value: PropertyOptionValue,
        color: Option<String>,
    ) -> Result<PropertyOption, Self::Err> {
        property_option_queries::create_property_option(
            &self.pool,
            property_definition_id,
            display_order,
            value,
            color,
        )
        .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn update_property_option(
        &self,
        option_id: Uuid,
        value: PropertyOptionValue,
        color: Option<String>,
        display_order: i32,
    ) -> Result<UpdatePropertyOptionOutcome, Self::Err> {
        property_option_queries::update_property_option(
            &self.pool,
            option_id,
            value,
            color,
            display_order,
        )
        .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_property_option(
        &self,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> Result<bool, Self::Err> {
        property_option_queries::delete_property_option(
            &self.pool,
            property_definition_id,
            option_id,
        )
        .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_tag_definition(
        &self,
        owner: PropertyDefinitionOwner<'_>,
    ) -> Result<Option<PropertyDefinition>, Self::Err> {
        property_definition_queries::get_tag_definition(&self.pool, owner).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_or_create_tag_definition(
        &self,
        owner: PropertyDefinitionOwner<'_>,
    ) -> Result<PropertyDefinition, Self::Err> {
        property_definition_queries::get_or_create_tag_definition(&self.pool, owner).await
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
    async fn add_entity_property_option(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> Result<(), Self::Err> {
        entity_property_queries::add_entity_property_option(
            &self.pool,
            entity_id,
            entity_type,
            property_definition_id,
            option_id,
        )
        .await
    }

    #[tracing::instrument(skip(self))]
    async fn remove_entity_property_option(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> Result<(), Self::Err> {
        entity_property_queries::remove_entity_property_option(
            &self.pool,
            entity_id,
            entity_type,
            property_definition_id,
            option_id,
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

    #[tracing::instrument(skip(self), err)]
    async fn get_entity_properties(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        tag_viewer_user_id: &str,
    ) -> Result<Vec<EntityPropertyInfo>, Self::Err> {
        entity_properties_get_query::get_entity_properties(
            &self.pool,
            entity_id,
            entity_type,
            tag_viewer_user_id,
        )
        .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_caller_tag_definitions(
        &self,
        user_id: &str,
    ) -> Result<Vec<PropertyDefinitionWithOptions>, Self::Err> {
        property_definition_queries::get_caller_tag_definitions_with_options(&self.pool, user_id)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_entity_properties_batch(
        &self,
        entity_refs: Vec<EntityReference>,
    ) -> Result<HashMap<EntityPropertiesKey, Vec<EntityPropertyWithDefinition>>, Self::Err> {
        let properties_by_entity_id =
            entity_properties_get_query::get_bulk_entity_properties_values(
                &self.pool,
                &entity_refs,
            )
            .await?;

        Ok(regroup_entity_properties(
            &entity_refs,
            properties_by_entity_id,
        ))
    }

    #[tracing::instrument(skip(self, entity_refs, property_ids), err)]
    async fn get_entity_properties_batch_filtered(
        &self,
        entity_refs: Vec<EntityReference>,
        property_ids: Vec<Uuid>,
        tag_viewer_user_id: Option<&MacroUserIdStr<'_>>,
    ) -> Result<HashMap<EntityPropertiesKey, Vec<EntityPropertyWithDefinition>>, Self::Err> {
        let properties_by_entity_id =
            entity_properties_get_query::get_bulk_entity_properties_values_filtered(
                &self.pool,
                &entity_refs,
                &property_ids,
                tag_viewer_user_id,
            )
            .await?;

        Ok(regroup_entity_properties(
            &entity_refs,
            properties_by_entity_id,
        ))
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_entity_properties_with_definitions(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Vec<EntityPropertyWithDefinition>, Self::Err> {
        entity_properties_get_query::get_entity_properties_values(
            &self.pool,
            entity_id,
            entity_type,
        )
        .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn lookup_entity_property(
        &self,
        entity_property_id: Uuid,
    ) -> Result<Option<EntityPropertyReference>, Self::Err> {
        entity_properties_get_query::lookup_entity_property(&self.pool, entity_property_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_entity_property(&self, entity_property_id: Uuid) -> Result<(), Self::Err> {
        entity_property_queries::delete_entity_property(&self.pool, entity_property_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_entity_properties(
        &self,
        entity_reference: &EntityReference,
    ) -> Result<(), Self::Err> {
        entity_property_queries::delete_entity_properties(&self.pool, entity_reference).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_document_metadata(
        &self,
        document_id: &str,
    ) -> Result<Option<DocumentMetadata>, Self::Err> {
        metadata_queries::get_document_metadata(&self.pool, document_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_thread_metadata(
        &self,
        thread_id: Uuid,
    ) -> Result<Option<ThreadMetadata>, Self::Err> {
        metadata_queries::get_thread_metadata(&self.pool, thread_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_project_metadata(
        &self,
        project_id: &str,
    ) -> Result<Option<ProjectMetadata>, Self::Err> {
        metadata_queries::get_project_metadata(&self.pool, project_id).await
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
