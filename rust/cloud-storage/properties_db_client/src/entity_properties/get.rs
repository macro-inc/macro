//! Entity property get operations.

use crate::error::PropertiesDatabaseError;
use sqlx::{Pool, Postgres};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use models_properties::service::entity_property::EntityProperty;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_value::PropertyValue;
use models_properties::{DataType, EntityReference, EntityType};

type Result<T> = std::result::Result<T, PropertiesDatabaseError>;

/// Database row data for entity property with definition
struct EntityPropertyRow {
    entity_property_id: Uuid,
    entity_id: String,
    entity_type: EntityType,
    property_definition_id: Uuid,
    entity_property_created_at: chrono::DateTime<chrono::Utc>,
    entity_property_updated_at: chrono::DateTime<chrono::Utc>,
    definition_organization_id: Option<i32>,
    definition_user_id: Option<String>,
    display_name: String,
    data_type: DataType,
    is_multi_select: bool,
    specific_entity_type: Option<Option<EntityType>>,
    definition_created_at: chrono::DateTime<chrono::Utc>,
    definition_updated_at: chrono::DateTime<chrono::Utc>,
    values: Option<sqlx::types::JsonValue>,
}

/// Helper to convert a database row into EntityPropertyWithDefinition
fn row_to_entity_property_with_definition(
    row: EntityPropertyRow,
) -> Result<EntityPropertyWithDefinition> {
    let owner = models_properties::PropertyOwner::from_optional_ids(
        row.definition_organization_id,
        row.definition_user_id,
    )
    .unwrap();

    let property_definition = PropertyDefinition {
        id: row.property_definition_id,
        owner,
        display_name: row.display_name,
        data_type: row.data_type,
        is_multi_select: row.is_multi_select,
        specific_entity_type: row.specific_entity_type.flatten(),
        created_at: row.definition_created_at,
        updated_at: row.definition_updated_at,
        is_metadata: false,
    };

    let property = EntityProperty {
        id: row.entity_property_id,
        entity_id: row.entity_id.clone(),
        entity_type: row.entity_type,
        property_definition_id: row.property_definition_id,
        created_at: row.entity_property_created_at,
        updated_at: row.entity_property_updated_at,
    };

    // Deserialize JSONB value (handle NULL)
    let value: Option<PropertyValue> = match row.values {
        None => None,
        Some(json_value) if json_value.is_null() => None,
        Some(json_value) => Some(serde_json::from_value(json_value).map_err(|e| {
            tracing::error!(
                error = ?e,
                entity_property_id = %row.entity_property_id,
                entity_id = %row.entity_id,
                "failed to deserialize property value from JSONB"
            );
            PropertiesDatabaseError::DeserializationError(e)
        })?),
    };

    Ok(EntityPropertyWithDefinition {
        property,
        definition: property_definition,
        value,
        options: None,
    })
}

/// Helper to sort properties by display name
fn sort_properties_by_display_name(properties: &mut [EntityPropertyWithDefinition]) {
    properties.sort_by(|a, b| {
        a.definition
            .display_name
            .to_lowercase()
            .cmp(&b.definition.display_name.to_lowercase())
    });
}

/// Validates and cleans select option values by deduplicating and filtering invalid IDs
fn validate_and_clean_select_option_value(
    property: &mut EntityPropertyWithDefinition,
    options: &[models_properties::service::property_option::PropertyOption],
) {
    let Some(PropertyValue::SelectOption(option_ids)) = &property.value else {
        return;
    };

    if option_ids.is_empty() {
        return;
    }

    // Handle case where property has option IDs but no valid options exist in DB
    if options.is_empty() {
        tracing::warn!(
            entity_property_id = %property.property.id,
            property_definition_id = %property.definition.id,
            option_ids_count = option_ids.len(),
            "select property has option IDs but no valid options exist in DB, clearing value"
        );
        property.value = Some(PropertyValue::SelectOption(vec![]));
        return;
    }

    // Deduplicate and validate option IDs
    let original_count = option_ids.len();
    let unique_ids: HashSet<Uuid> = option_ids.iter().copied().collect();
    let unique_count = unique_ids.len();

    let valid_ids_set: HashSet<Uuid> = options.iter().map(|opt| opt.id).collect();
    let valid_option_ids: Vec<Uuid> = unique_ids
        .into_iter()
        .filter(|id| valid_ids_set.contains(id))
        .collect();

    let has_invalid = valid_option_ids.len() != unique_count;
    let has_duplicates = unique_count != original_count;

    if has_invalid || has_duplicates {
        let invalid_count = unique_count - valid_option_ids.len();
        let duplicate_count = original_count - unique_count;

        tracing::warn!(
            entity_property_id = %property.property.id,
            property_definition_id = %property.definition.id,
            original_count = original_count,
            valid_count = valid_option_ids.len(),
            invalid_count = invalid_count,
            duplicate_count = duplicate_count,
            "filtered and deduplicated option IDs from entity property value"
        );

        property.value = Some(PropertyValue::SelectOption(valid_option_ids));
    }
}

/// Defensively clears stale select options/values from non-select properties
fn clear_stale_select_data(property: &mut EntityPropertyWithDefinition) {
    if property.options.is_some() {
        tracing::warn!(
            entity_property_id = %property.property.id,
            property_definition_id = %property.definition.id,
            data_type = ?property.definition.data_type,
            "non-select property has options attached, clearing"
        );
        property.options = None;
    }

    if matches!(property.value, Some(PropertyValue::SelectOption(_))) {
        tracing::warn!(
            entity_property_id = %property.property.id,
            property_definition_id = %property.definition.id,
            data_type = ?property.definition.data_type,
            "non-select property has SelectOption value, clearing"
        );
        property.value = None;
    }
}

/// Helper to fetch and attach property options to properties.
/// Also validates and deduplicates option IDs in property values.
/// Defensively clears stale options/values on non-select properties.
async fn attach_property_options(
    db: &Pool<Postgres>,
    properties: &mut [EntityPropertyWithDefinition],
) -> Result<()> {
    // Collect select-type property IDs for batch fetch
    let property_ids_needing_options: Vec<Uuid> = properties
        .iter()
        .filter(|p| {
            matches!(
                p.definition.data_type,
                DataType::SelectString | DataType::SelectNumber
            )
        })
        .map(|p| p.definition.id)
        .collect();

    // Fetch all options in one query (empty if no select properties)
    let options_map = if !property_ids_needing_options.is_empty() {
        crate::property_options::get::get_property_options_batch(db, &property_ids_needing_options)
            .await?
    } else {
        HashMap::new()
    };

    // Process ALL properties
    for property in properties {
        let is_select_type = matches!(
            property.definition.data_type,
            DataType::SelectString | DataType::SelectNumber
        );

        if is_select_type {
            let options = options_map
                .get(&property.definition.id)
                .cloned()
                .unwrap_or_default();

            property.options = Some(options.clone());
            validate_and_clean_select_option_value(property, &options);
        } else {
            clear_stale_select_data(property);
        }
    }

    Ok(())
}

/// Gets the entity_id and entity_type for a given entity_property_id.
/// Used for permission checking before deletion.
#[tracing::instrument(skip(db))]
pub async fn get_entity_type_from_entity_property(
    db: &Pool<Postgres>,
    entity_property_id: Uuid,
) -> Result<Option<EntityReference>> {
    let row = sqlx::query!(
        r#"
        SELECT 
            entity_id,
            entity_type as "entity_type: EntityType"
        FROM entity_properties
        WHERE id = $1
        "#,
        entity_property_id
    )
    .fetch_optional(db)
    .await?;

    Ok(row.map(|r| EntityReference {
        entity_id: r.entity_id,
        entity_type: r.entity_type,
    }))
}

/// Gets entity properties with their definitions and values.
#[tracing::instrument(skip(db))]
pub async fn get_entity_properties_values(
    db: &Pool<Postgres>,
    entity_id: &str,
    entity_type: EntityType,
) -> Result<Vec<EntityPropertyWithDefinition>> {
    let rows = sqlx::query!(
        r#"
        SELECT 
            ep.id as entity_property_id,
            ep.entity_id,
            ep.entity_type as "entity_type: EntityType",
            ep.property_definition_id,
            ep.values as "values: sqlx::types::JsonValue",
            ep.created_at as entity_property_created_at,
            ep.updated_at as entity_property_updated_at,
            pd.organization_id as definition_organization_id,
            pd.user_id as definition_user_id,
            pd.display_name,
            pd.data_type as "data_type: DataType",
            pd.is_multi_select,
            pd.specific_entity_type as "specific_entity_type: Option<EntityType>",
            pd.created_at as definition_created_at,
            pd.updated_at as definition_updated_at
        FROM entity_properties ep
        INNER JOIN property_definitions pd ON ep.property_definition_id = pd.id
        WHERE ep.entity_id = $1 AND ep.entity_type = $2
        "#,
        entity_id,
        entity_type as EntityType
    )
    .fetch_all(db)
    .await?;

    let mut result: Vec<EntityPropertyWithDefinition> = rows
        .into_iter()
        .map(|row| {
            row_to_entity_property_with_definition(EntityPropertyRow {
                entity_property_id: row.entity_property_id,
                entity_id: row.entity_id,
                entity_type: row.entity_type,
                property_definition_id: row.property_definition_id,
                entity_property_created_at: row.entity_property_created_at,
                entity_property_updated_at: row.entity_property_updated_at,
                definition_organization_id: row.definition_organization_id,
                definition_user_id: row.definition_user_id,
                display_name: row.display_name,
                data_type: row.data_type,
                is_multi_select: row.is_multi_select,
                specific_entity_type: row.specific_entity_type,
                definition_created_at: row.definition_created_at,
                definition_updated_at: row.definition_updated_at,
                values: row.values,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    // Sort by display name
    sort_properties_by_display_name(&mut result);

    // Fetch and attach property options
    attach_property_options(db, &mut result).await?;

    Ok(result)
}

/// Gets entity properties with their definitions and values for multiple entities.
/// Returns a HashMap where the key is the entity_id and the value is Vec<EntityPropertyWithDefinition>.
#[tracing::instrument(skip(db))]
pub async fn get_bulk_entity_properties_values(
    db: &Pool<Postgres>,
    entity_refs: &[EntityReference],
) -> Result<HashMap<String, Vec<EntityPropertyWithDefinition>>> {
    if entity_refs.is_empty() {
        return Ok(HashMap::new());
    }

    // Use UNNEST to match entity_id and entity_type as pairs
    let entity_ids: Vec<String> = entity_refs.iter().map(|r| r.entity_id.clone()).collect();
    let entity_types: Vec<EntityType> = entity_refs.iter().map(|r| r.entity_type).collect();

    let rows = sqlx::query!(
        r#"
        SELECT 
            ep.id as entity_property_id,
            ep.entity_id,
            ep.entity_type as "entity_type: EntityType",
            ep.property_definition_id,
            ep.values as "values: sqlx::types::JsonValue",
            ep.created_at as entity_property_created_at,
            ep.updated_at as entity_property_updated_at,
            pd.organization_id as definition_organization_id,
            pd.user_id as definition_user_id,
            pd.display_name,
            pd.data_type as "data_type: DataType",
            pd.is_multi_select,
            pd.specific_entity_type as "specific_entity_type: Option<EntityType>",
            pd.created_at as definition_created_at,
            pd.updated_at as definition_updated_at
        FROM entity_properties ep
        INNER JOIN property_definitions pd ON ep.property_definition_id = pd.id
        WHERE (ep.entity_id, ep.entity_type) IN (
            SELECT * FROM UNNEST($1::TEXT[], $2::property_entity_type[])
        )
        "#,
        &entity_ids,
        &entity_types as &[EntityType]
    )
    .fetch_all(db)
    .await?;

    // Group by entity_id
    let mut entity_properties_map: HashMap<String, Vec<EntityPropertyWithDefinition>> =
        HashMap::new();

    for row in rows {
        let entity_id = row.entity_id.clone();
        let property_with_definition = row_to_entity_property_with_definition(EntityPropertyRow {
            entity_property_id: row.entity_property_id,
            entity_id: row.entity_id,
            entity_type: row.entity_type,
            property_definition_id: row.property_definition_id,
            entity_property_created_at: row.entity_property_created_at,
            entity_property_updated_at: row.entity_property_updated_at,
            definition_organization_id: row.definition_organization_id,
            definition_user_id: row.definition_user_id,
            display_name: row.display_name,
            data_type: row.data_type,
            is_multi_select: row.is_multi_select,
            specific_entity_type: row.specific_entity_type,
            definition_created_at: row.definition_created_at,
            definition_updated_at: row.definition_updated_at,
            values: row.values,
        })?;

        entity_properties_map
            .entry(entity_id)
            .or_default()
            .push(property_with_definition);
    }

    // Sort each entity's properties by display name
    for properties in entity_properties_map.values_mut() {
        sort_properties_by_display_name(properties);
    }

    // Fetch and attach property options for all properties
    // TODO @danielkweon - optimize by caching property options per property_definition_id
    // to avoid redundant fetches when multiple entities share the same property definition
    for properties in entity_properties_map.values_mut() {
        attach_property_options(db, properties).await?;
    }

    // Ensure all requested entity_ids are present in the result, even if they have no properties
    for entity_ref in entity_refs {
        entity_properties_map
            .entry(entity_ref.entity_id.clone())
            .or_default();
    }

    Ok(entity_properties_map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_entity_properties_values(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_entity_properties_values(&pool, "doc1", EntityType::Document).await?;

        // doc1 has 7 properties in fixtures
        assert_eq!(properties.len(), 6);

        // Verify they are sorted by display name (case-insensitive alphabetical)
        assert_eq!(properties[0].definition.display_name, "Assigned To");
        assert_eq!(properties[1].definition.display_name, "Completed");
        assert_eq!(properties[2].definition.display_name, "Department");
        assert_eq!(properties[3].definition.display_name, "Description");
        assert_eq!(properties[4].definition.display_name, "Due Date");
        assert_eq!(properties[5].definition.display_name, "Priority");

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_entity_properties_values_with_select_options(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_entity_properties_values(&pool, "doc1", EntityType::Document).await?;

        // Find Priority property
        let priority_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Priority")
            .unwrap();

        // Verify it has options attached
        assert!(priority_prop.options.is_some());
        let options = priority_prop.options.as_ref().unwrap();
        assert_eq!(options.len(), 4);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_entity_properties_values_boolean_value(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_entity_properties_values(&pool, "doc1", EntityType::Document).await?;

        // Find Completed property (boolean)
        let completed_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Completed")
            .unwrap();

        // Verify boolean value
        if let Some(PropertyValue::Bool(val)) = completed_prop.value {
            assert!(!val); // doc1 has false
        } else {
            panic!("Expected boolean value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_entity_properties_values_string_value(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_entity_properties_values(&pool, "doc1", EntityType::Document).await?;

        // Find Description property (string)
        let desc_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Description")
            .unwrap();

        // Verify string value
        if let Some(PropertyValue::Str(val)) = &desc_prop.value {
            assert_eq!(val, "Important document for testing");
        } else {
            panic!("Expected string value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_entity_properties_values_null_values(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_entity_properties_values(&pool, "doc3", EntityType::Document).await?;

        // doc3 has 3 properties with NULL values
        assert_eq!(properties.len(), 3);

        for prop in properties {
            assert!(prop.value.is_none());
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_entity_properties_values_empty(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties =
            get_entity_properties_values(&pool, "nonexistent", EntityType::Document).await?;

        assert_eq!(properties.len(), 0);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_bulk_entity_properties_values(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let entity_refs = vec![
            EntityReference {
                entity_id: "doc1".to_string(),
                entity_type: EntityType::Document,
            },
            EntityReference {
                entity_id: "doc2".to_string(),
                entity_type: EntityType::Document,
            },
            EntityReference {
                entity_id: "proj1".to_string(),
                entity_type: EntityType::Project,
            },
        ];
        let properties_map = get_bulk_entity_properties_values(&pool, &entity_refs).await?;

        assert_eq!(properties_map.len(), 3);
        assert_eq!(properties_map.get("doc1").unwrap().len(), 6);
        assert_eq!(properties_map.get("doc2").unwrap().len(), 4);
        assert_eq!(properties_map.get("proj1").unwrap().len(), 5);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_bulk_entity_properties_values_includes_empty_entities(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let entity_refs = vec![
            EntityReference {
                entity_id: "doc1".to_string(),
                entity_type: EntityType::Document,
            },
            EntityReference {
                entity_id: "nonexistent".to_string(),
                entity_type: EntityType::Document,
            },
        ];
        let properties_map = get_bulk_entity_properties_values(&pool, &entity_refs).await?;

        // Both entities should be in the map
        assert_eq!(properties_map.len(), 2);
        assert!(properties_map.contains_key("doc1"));
        assert!(properties_map.contains_key("nonexistent"));

        // nonexistent should have empty array
        assert_eq!(properties_map.get("nonexistent").unwrap().len(), 0);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_bulk_entity_properties_values_empty_input(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let entity_refs: Vec<EntityReference> = vec![];
        let properties_map = get_bulk_entity_properties_values(&pool, &entity_refs).await?;

        assert_eq!(properties_map.len(), 0);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_entity_type_from_entity_property(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let entity_property_id = "e0111111-1111-1111-1111-111111111111"
            .parse::<Uuid>()
            .unwrap();
        let entity_ref = get_entity_type_from_entity_property(&pool, entity_property_id).await?;

        assert!(entity_ref.is_some());
        let entity_ref = entity_ref.unwrap();
        assert_eq!(entity_ref.entity_id, "doc1");
        assert_eq!(entity_ref.entity_type, EntityType::Document);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_entity_type_from_entity_property_not_found(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let entity_property_id = "00000000-0000-0000-0000-000000000000"
            .parse::<Uuid>()
            .unwrap();
        let entity_ref = get_entity_type_from_entity_property(&pool, entity_property_id).await?;

        assert!(entity_ref.is_none());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_entity_properties_entity_reference_single(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_entity_properties_values(&pool, "doc1", EntityType::Document).await?;

        // Find Assigned To property (ENTITY type with 1 user)
        let assigned_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Assigned To")
            .unwrap();

        // Verify it's an ENTITY type property
        assert_eq!(assigned_prop.definition.data_type, DataType::Entity);
        assert_eq!(
            assigned_prop.definition.specific_entity_type,
            Some(EntityType::User)
        );
        assert!(assigned_prop.definition.is_multi_select); // Multi-select enabled

        // Verify it has 1 user reference
        if let Some(PropertyValue::EntityRef(refs)) = &assigned_prop.value {
            assert_eq!(refs.len(), 1);
            assert_eq!(refs[0].entity_id, "user1");
            assert_eq!(refs[0].entity_type, EntityType::User);
        } else {
            panic!("Expected EntityReference value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_entity_properties_entity_reference_multiple(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_entity_properties_values(&pool, "doc2", EntityType::Document).await?;

        // Find Assigned To property (ENTITY type with 2 users)
        let assigned_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Assigned To")
            .unwrap();

        // Verify it has 2 user references
        if let Some(PropertyValue::EntityRef(refs)) = &assigned_prop.value {
            assert_eq!(refs.len(), 2);

            // Verify both users are present
            let user_ids: Vec<&str> = refs.iter().map(|r| r.entity_id.as_str()).collect();
            assert!(user_ids.contains(&"user1"));
            assert!(user_ids.contains(&"user2"));

            // All should be USER entity type
            for ref_val in refs {
                assert_eq!(ref_val.entity_type, EntityType::User);
            }
        } else {
            panic!("Expected EntityReference value with 2 users");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_entity_properties_entity_reference_null(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_entity_properties_values(&pool, "doc3", EntityType::Document).await?;

        // Find Assigned To property (NULL value)
        let assigned_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Assigned To")
            .unwrap();

        // Verify the property exists but value is NULL
        assert_eq!(assigned_prop.definition.data_type, DataType::Entity);
        assert!(assigned_prop.value.is_none());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_entity_properties_multi_select_string(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_entity_properties_values(&pool, "doc2", EntityType::Document).await?;

        // Find Department property (multi-select SELECT_STRING)
        let dept_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Department")
            .unwrap();

        // Verify it's multi-select
        assert_eq!(dept_prop.definition.data_type, DataType::SelectString);
        assert!(dept_prop.definition.is_multi_select);

        // Verify it has options attached
        assert!(dept_prop.options.is_some());
        let options = dept_prop.options.as_ref().unwrap();
        assert_eq!(options.len(), 3); // Engineering, Marketing, Human Resources

        // Verify it has 2 selected values
        if let Some(PropertyValue::SelectOption(ids)) = &dept_prop.value {
            assert_eq!(ids.len(), 2);

            // Verify the selected options are valid
            for id in ids {
                assert!(options.iter().any(|opt| opt.id == *id));
            }
        } else {
            panic!("Expected SelectOption value with 2 departments");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_entity_properties_date_value(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_entity_properties_values(&pool, "doc1", EntityType::Document).await?;

        // Find Due Date property (DATE type)
        let date_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Due Date")
            .unwrap();

        // Verify it's a DATE type
        assert_eq!(date_prop.definition.data_type, DataType::Date);

        // Verify it has a date value
        if let Some(PropertyValue::Date(date)) = &date_prop.value {
            // Verify the date is 2025-12-31
            assert_eq!(date.year(), 2025);
            assert_eq!(date.month(), 12);
            assert_eq!(date.day(), 31);
        } else {
            panic!("Expected Date value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_entity_properties_link_value(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_entity_properties_values(&pool, "proj1", EntityType::Project).await?;

        // Find Website property (LINK type)
        let link_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Website")
            .unwrap();

        // Verify it's a LINK type
        assert_eq!(link_prop.definition.data_type, DataType::Link);

        // Verify it has a link value
        if let Some(PropertyValue::Link(links)) = &link_prop.value {
            assert_eq!(links.len(), 1);
            assert_eq!(links[0], "https://example.com");
        } else {
            panic!("Expected Link value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_entity_properties_number_value(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_entity_properties_values(&pool, "proj1", EntityType::Project).await?;

        // Find Budget property (NUMBER type)
        let budget_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Budget")
            .unwrap();

        // Verify it's a NUMBER type
        assert_eq!(budget_prop.definition.data_type, DataType::Number);

        // Verify it has the correct number value
        if let Some(PropertyValue::Num(val)) = budget_prop.value {
            assert_eq!(val, 50000.50);
        } else {
            panic!("Expected Number value");
        }

        Ok(())
    }
}
