//! Entity property storage operations

use models_properties::service::{
    EntityProperty, PropertyDefinition, PropertyOption, PropertyOptionValue, PropertyValue,
};
use models_properties::shared::{DataType, EntityType, PropertyOwner};
use sqlx::PgPool;
use std::collections::HashMap;
use std::str::FromStr;
use uuid::Uuid;

use super::PropertiesStorageError;
use crate::domain::models::EntityPropertyWithDefinition;

pub async fn get_entity_properties_with_values(
    pool: &PgPool,
    entity_id: &str,
    entity_type: EntityType,
    organization_id: Option<i32>,
    user_id: String,
    include_metadata: bool,
) -> Result<Vec<EntityPropertyWithDefinition>, PropertiesStorageError> {
    let entity_type_str = entity_type.to_string();

    let rows = sqlx::query!(
        r#"
        SELECT 
            ep.entity_id,
            ep.entity_type AS "entity_type!",
            ep.property_definition_id,
            ep.created_at AS ep_created_at,
            ep.updated_at AS ep_updated_at,
            ep.value AS property_value,
            pd.id AS def_id,
            pd.organization_id,
            pd.user_id,
            pd.display_name,
            pd.data_type,
            pd.is_multi_select,
            pd.specific_entity_type,
            pd.is_metadata,
            pd.created_at AS def_created_at,
            pd.updated_at AS def_updated_at
        FROM entity_properties ep
        INNER JOIN property_definitions pd ON ep.property_definition_id = pd.id
        WHERE ep.entity_id = $1 
          AND ep.entity_type = $2::property_entity_type
          AND (
            (pd.organization_id = $3 AND pd.user_id IS NULL) OR
            (pd.organization_id IS NULL AND pd.user_id = $4) OR
            (pd.organization_id = $3 AND pd.user_id = $4)
          )
          AND ($5 OR pd.is_metadata = FALSE)
        ORDER BY pd.display_name
        "#,
        entity_id,
        entity_type_str,
        organization_id,
        user_id,
        include_metadata,
    )
    .fetch_all(pool)
    .await?;

    let mut result = Vec::new();
    let mut property_definition_ids = Vec::new();

    for row in &rows {
        property_definition_ids.push(row.property_definition_id);
    }

    // Get all options in one batch query
    let options_map = if !property_definition_ids.is_empty() {
        get_options_batch(pool, &property_definition_ids).await?
    } else {
        HashMap::new()
    };

    for row in rows {
        let entity_property = EntityProperty {
            entity_id: row.entity_id,
            entity_type: EntityType::from_str(&row.entity_type)
                .map_err(|e| PropertiesStorageError::Parse(e))?,
            property_definition_id: row.property_definition_id,
            created_at: row.ep_created_at,
            updated_at: row.ep_updated_at,
        };

        let definition = PropertyDefinition {
            id: row.def_id,
            display_name: row.display_name,
            data_type: DataType::from_str(&row.data_type)
                .map_err(|e| PropertiesStorageError::Parse(e))?,
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
            created_at: row.def_created_at,
            updated_at: row.def_updated_at,
            is_metadata: row.is_metadata,
        };

        let value: Option<PropertyValue> = row
            .property_value
            .and_then(|v| serde_json::from_value(v).ok());

        let options = options_map.get(&row.property_definition_id).cloned();

        result.push(EntityPropertyWithDefinition {
            property: entity_property,
            definition,
            value,
            options,
        });
    }

    Ok(result)
}

pub async fn set_entity_property(
    pool: &PgPool,
    entity_property: EntityProperty,
    value: Option<PropertyValue>,
) -> Result<(EntityProperty, Option<PropertyValue>), PropertiesStorageError> {
    let entity_type_str = entity_property.entity_type.to_string();
    let value_json = value
        .as_ref()
        .map(|v| serde_json::to_value(v).ok())
        .flatten();

    let row = sqlx::query!(
        r#"
        INSERT INTO entity_properties (
            entity_id, entity_type, property_definition_id, value
        )
        VALUES ($1, $2::property_entity_type, $3, $4)
        ON CONFLICT (entity_id, entity_type, property_definition_id)
        DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = NOW()
        RETURNING entity_id, entity_type AS "entity_type!", property_definition_id,
                  created_at, updated_at, value
        "#,
        entity_property.entity_id,
        entity_type_str,
        entity_property.property_definition_id,
        value_json,
    )
    .fetch_one(pool)
    .await?;

    let returned_entity = EntityProperty {
        entity_id: row.entity_id,
        entity_type: EntityType::from_str(&row.entity_type)
            .map_err(|e| PropertiesStorageError::Parse(e))?,
        property_definition_id: row.property_definition_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };

    let returned_value: Option<PropertyValue> =
        row.value.and_then(|v| serde_json::from_value(v).ok());

    Ok((returned_entity, returned_value))
}

pub async fn delete_entity_property(
    pool: &PgPool,
    entity_id: String,
    entity_type: EntityType,
    property_definition_id: Uuid,
) -> Result<(), PropertiesStorageError> {
    let entity_type_str = entity_type.to_string();

    sqlx::query!(
        r#"
        DELETE FROM entity_properties
        WHERE entity_id = $1 
          AND entity_type = $2::property_entity_type
          AND property_definition_id = $3
        "#,
        entity_id,
        entity_type_str,
        property_definition_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn delete_all_entity_properties(
    pool: &PgPool,
    entity_id: String,
    entity_type: EntityType,
) -> Result<u64, PropertiesStorageError> {
    let entity_type_str = entity_type.to_string();

    let result = sqlx::query!(
        r#"
        DELETE FROM entity_properties
        WHERE entity_id = $1 AND entity_type = $2::property_entity_type
        "#,
        entity_id,
        entity_type_str,
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn get_bulk_entity_properties(
    pool: &PgPool,
    entity_refs: Vec<(String, EntityType)>,
) -> Result<HashMap<String, Vec<EntityPropertyWithDefinition>>, PropertiesStorageError> {
    if entity_refs.is_empty() {
        return Ok(HashMap::new());
    }

    let entity_ids: Vec<String> = entity_refs.iter().map(|(id, _)| id.clone()).collect();
    let entity_types: Vec<String> = entity_refs.iter().map(|(_, et)| et.to_string()).collect();

    let rows = sqlx::query!(
        r#"
        SELECT 
            ep.entity_id,
            ep.entity_type AS "entity_type!",
            ep.property_definition_id,
            ep.created_at AS ep_created_at,
            ep.updated_at AS ep_updated_at,
            ep.value AS property_value,
            pd.id AS def_id,
            pd.organization_id,
            pd.user_id,
            pd.display_name,
            pd.data_type,
            pd.is_multi_select,
            pd.specific_entity_type,
            pd.is_metadata,
            pd.created_at AS def_created_at,
            pd.updated_at AS def_updated_at
        FROM UNNEST($1::TEXT[], $2::property_entity_type[]) AS input(entity_id, entity_type)
        INNER JOIN entity_properties ep 
            ON ep.entity_id = input.entity_id 
            AND ep.entity_type = input.entity_type
        INNER JOIN property_definitions pd ON ep.property_definition_id = pd.id
        ORDER BY ep.entity_id, pd.display_name
        "#,
        &entity_ids,
        &entity_types as &[String],
    )
    .fetch_all(pool)
    .await?;

    let mut result: HashMap<String, Vec<EntityPropertyWithDefinition>> = HashMap::new();
    let mut property_definition_ids = Vec::new();

    for row in &rows {
        property_definition_ids.push(row.property_definition_id);
    }

    // Get all options in one batch query
    let options_map = if !property_definition_ids.is_empty() {
        get_options_batch(pool, &property_definition_ids).await?
    } else {
        HashMap::new()
    };

    for row in rows {
        let entity_property = EntityProperty {
            entity_id: row.entity_id.clone(),
            entity_type: EntityType::from_str(&row.entity_type)
                .map_err(|e| PropertiesStorageError::Parse(e))?,
            property_definition_id: row.property_definition_id,
            created_at: row.ep_created_at,
            updated_at: row.ep_updated_at,
        };

        let definition = PropertyDefinition {
            id: row.def_id,
            display_name: row.display_name,
            data_type: DataType::from_str(&row.data_type)
                .map_err(|e| PropertiesStorageError::Parse(e))?,
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
            created_at: row.def_created_at,
            updated_at: row.def_updated_at,
            is_metadata: row.is_metadata,
        };

        let value: Option<PropertyValue> = row
            .property_value
            .and_then(|v| serde_json::from_value(v).ok());

        let options = options_map.get(&row.property_definition_id).cloned();

        result
            .entry(row.entity_id)
            .or_insert_with(Vec::new)
            .push(EntityPropertyWithDefinition {
                property: entity_property,
                definition,
                value,
                options,
            });
    }

    Ok(result)
}

// ===== Helper Functions =====

async fn get_options_batch(
    pool: &PgPool,
    property_definition_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<PropertyOption>>, PropertiesStorageError> {
    if property_definition_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query!(
        r#"
        SELECT id, property_definition_id, display_order, number_value, string_value,
               created_at, updated_at
        FROM property_options
        WHERE property_definition_id = ANY($1)
        ORDER BY property_definition_id, display_order, number_value, LOWER(string_value)
        "#,
        property_definition_ids,
    )
    .fetch_all(pool)
    .await?;

    let mut result: HashMap<Uuid, Vec<PropertyOption>> = HashMap::new();

    for row in rows {
        let value = if let Some(num) = row.number_value {
            PropertyOptionValue::Number(num)
        } else if let Some(string) = row.string_value {
            PropertyOptionValue::String(string)
        } else {
            return Err(PropertiesStorageError::Parse(
                "Property option must have either number_value or string_value".to_string(),
            ));
        };

        let option = PropertyOption {
            id: row.id,
            property_definition_id: row.property_definition_id,
            display_order: row.display_order,
            value,
            created_at: row.created_at,
            updated_at: row.updated_at,
        };

        result
            .entry(row.property_definition_id)
            .or_insert_with(Vec::new)
            .push(option);
    }

    Ok(result)
}
