//! Property definition storage operations

use models_properties::service::{PropertyDefinition, PropertyOption, PropertyOptionValue};
use models_properties::shared::{DataType, EntityType, PropertyOwner};
use sqlx::PgPool;
use std::str::FromStr;

use super::PropertiesStorageError;
use crate::domain::models::PropertyDefinitionWithOptions;

pub async fn create_property_definition(
    pool: &PgPool,
    definition: PropertyDefinition,
) -> Result<PropertyDefinition, PropertiesStorageError> {
    let data_type_str = definition.data_type.to_string();
    let entity_type_str = definition
        .specific_entity_type
        .as_ref()
        .map(|t| t.to_string());
    let (org_id, user_id) = match &definition.owner {
        PropertyOwner::Organization { organization_id } => (Some(*organization_id), None),
        PropertyOwner::User { user_id } => (None, Some(user_id.as_str())),
        PropertyOwner::UserAndOrganization {
            user_id,
            organization_id,
        } => (Some(*organization_id), Some(user_id.as_str())),
    };

    let row = sqlx::query!(
        r#"
        INSERT INTO property_definitions (
            id, organization_id, user_id, display_name, data_type,
            is_multi_select, specific_entity_type, is_metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, organization_id, user_id, display_name, data_type,
                  is_multi_select, specific_entity_type, is_metadata,
                  created_at, updated_at
        "#,
        definition.id,
        org_id,
        user_id,
        definition.display_name,
        data_type_str,
        definition.is_multi_select,
        entity_type_str.as_deref(),
        definition.is_metadata,
    )
    .fetch_one(pool)
    .await?;

    Ok(PropertyDefinition {
        id: row.id,
        display_name: row.display_name,
        data_type: DataType::from_str(&row.data_type)
            .map_err(|e| PropertiesStorageError::Parse(e.to_string()))?,
        owner: PropertyOwner::from_optional_ids(row.organization_id, row.user_id).ok_or_else(
            || {
                PropertiesStorageError::Parse(
                    "Property definition must have at least one owner".to_string(),
                )
            },
        )?,
        is_multi_select: row.is_multi_select,
        specific_entity_type: row
            .specific_entity_type
            .and_then(|s| EntityType::from_str(&s).ok()),
        created_at: row.created_at,
        updated_at: row.updated_at,
        is_metadata: row.is_metadata,
    })
}

pub async fn create_property_definition_with_options(
    pool: &PgPool,
    definition: PropertyDefinition,
    options: Vec<PropertyOption>,
) -> Result<PropertyDefinitionWithOptions, PropertiesStorageError> {
    // Start transaction
    let mut tx = pool.begin().await?;

    let data_type_str = definition.data_type.to_string();
    let entity_type_str = definition
        .specific_entity_type
        .as_ref()
        .map(|t| t.to_string());
    let (org_id, user_id) = match &definition.owner {
        PropertyOwner::Organization { organization_id } => (Some(*organization_id), None),
        PropertyOwner::User { user_id } => (None, Some(user_id.as_str())),
        PropertyOwner::UserAndOrganization {
            user_id,
            organization_id,
        } => (Some(*organization_id), Some(user_id.as_str())),
    };

    // Insert property definition
    let row = sqlx::query!(
        r#"
        INSERT INTO property_definitions (
            id, organization_id, user_id, display_name, data_type,
            is_multi_select, specific_entity_type, is_metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, organization_id, user_id, display_name, data_type,
                  is_multi_select, specific_entity_type, is_metadata,
                  created_at, updated_at
        "#,
        definition.id,
        org_id,
        user_id,
        definition.display_name,
        data_type_str,
        definition.is_multi_select,
        entity_type_str.as_deref(),
        definition.is_metadata,
    )
    .fetch_one(&mut *tx)
    .await?;

    let created_definition = PropertyDefinition {
        id: row.id,
        display_name: row.display_name,
        data_type: DataType::from_str(&row.data_type)
            .map_err(|e| PropertiesStorageError::Parse(e.to_string()))?,
        owner: PropertyOwner::from_optional_ids(row.organization_id, row.user_id).ok_or_else(
            || {
                PropertiesStorageError::Parse(
                    "Property definition must have at least one owner".to_string(),
                )
            },
        )?,
        is_multi_select: row.is_multi_select,
        specific_entity_type: row
            .specific_entity_type
            .and_then(|s| EntityType::from_str(&s).ok()),
        created_at: row.created_at,
        updated_at: row.updated_at,
        is_metadata: row.is_metadata,
    };

    // Insert property options
    let mut created_options = Vec::new();
    for option in options {
        let (number_value, string_value) = match &option.value {
            PropertyOptionValue::Number(n) => (Some(*n), None),
            PropertyOptionValue::String(s) => (None, Some(s.as_str())),
        };

        let opt_row = sqlx::query!(
            r#"
            INSERT INTO property_options (
                id, property_definition_id, display_order, number_value, string_value
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, property_definition_id, display_order, number_value, string_value,
                      created_at, updated_at
            "#,
            option.id,
            created_definition.id,
            option.display_order,
            number_value,
            string_value,
        )
        .fetch_one(&mut *tx)
        .await?;

        let value = if let Some(num) = opt_row.number_value {
            PropertyOptionValue::Number(num)
        } else if let Some(string) = opt_row.string_value {
            PropertyOptionValue::String(string)
        } else {
            return Err(PropertiesStorageError::Parse(
                "Property option must have either number_value or string_value".to_string(),
            ));
        };

        created_options.push(PropertyOption {
            id: opt_row.id,
            property_definition_id: opt_row.property_definition_id,
            display_order: opt_row.display_order,
            value,
            created_at: opt_row.created_at,
            updated_at: opt_row.updated_at,
        });
    }

    // Commit transaction
    tx.commit().await?;

    Ok(PropertyDefinitionWithOptions {
        definition: created_definition,
        property_options: created_options,
    })
}
