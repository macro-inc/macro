//! Queries to read the properties attached to entities.

use std::collections::{HashMap, HashSet};

use models_properties::service::entity_property::EntityProperty;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use models_properties::{DataType, EntityPropertyReference, EntityReference, EntityType};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::property_option_queries;
use crate::domain::model::{EntityPropertyInfo, PropertyOptionInfo};

/// Database row from the joined query.
struct PropertyRow {
    property_definition_id: Uuid,
    display_name: String,
    data_type: DataType,
    is_multi_select: bool,
    is_system: bool,
    values: Option<serde_json::Value>,
}

/// Database row for property options.
struct OptionRow {
    id: Uuid,
    property_definition_id: Uuid,
    display_order: i32,
    string_value: Option<String>,
    number_value: Option<f64>,
}

/// Get all properties attached to an entity, with their definitions, values, and options.
/// Tag properties are restricted to definitions the viewer can see: their own
/// and their teams'. Results are sorted by display_name (case-insensitive).
#[tracing::instrument(skip(pool))]
pub async fn get_entity_properties(
    pool: &Pool<Postgres>,
    entity_id: &str,
    entity_type: EntityType,
    tag_viewer_user_id: &str,
) -> anyhow::Result<Vec<EntityPropertyInfo>> {
    // Fetch all entity properties with their definitions
    let rows = sqlx::query_as!(
        PropertyRow,
        r#"
        SELECT
            ep.property_definition_id,
            pd.display_name,
            pd.data_type as "data_type: DataType",
            pd.is_multi_select,
            pd.is_system,
            ep.values as "values: serde_json::Value"
        FROM entity_properties ep
        INNER JOIN property_definitions pd ON pd.id = ep.property_definition_id
        WHERE ep.entity_id = $1
          AND ep.entity_type = $2
          AND (
            pd.data_type <> $4
            OR pd.user_id = $3
            OR pd.team_id IN (SELECT tu.team_id FROM team_user tu WHERE tu.user_id = $3)
          )
        ORDER BY LOWER(pd.display_name)
        "#,
        entity_id,
        entity_type as EntityType,
        tag_viewer_user_id,
        DataType::Tag as DataType,
    )
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    // Collect all property definition IDs that are select types to fetch options
    let select_prop_ids: Vec<Uuid> = rows
        .iter()
        .filter(|r| {
            matches!(
                r.data_type,
                DataType::SelectString | DataType::SelectNumber | DataType::Tag
            )
        })
        .map(|r| r.property_definition_id)
        .collect();

    // Fetch options for all select-type properties in one query
    let option_rows = if select_prop_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as!(
            OptionRow,
            r#"
            SELECT
                id,
                property_definition_id,
                display_order,
                string_value,
                number_value
            FROM property_options
            WHERE property_definition_id = ANY($1)
            ORDER BY display_order
            "#,
            &select_prop_ids,
        )
        .fetch_all(pool)
        .await?
    };

    // Group options by property_definition_id
    let mut options_map: std::collections::HashMap<Uuid, Vec<PropertyOptionInfo>> =
        std::collections::HashMap::new();
    for opt in option_rows {
        let value = if let Some(s) = opt.string_value {
            PropertyOptionValue::String(s)
        } else if let Some(n) = opt.number_value {
            PropertyOptionValue::Number(n)
        } else {
            continue;
        };
        options_map
            .entry(opt.property_definition_id)
            .or_default()
            .push(PropertyOptionInfo {
                id: opt.id,
                display_order: opt.display_order,
                value,
            });
    }

    // Build result
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let value = match row.values {
            None => None,
            Some(v) if v.is_null() => None,
            Some(v) => Some(serde_json::from_value::<PropertyValue>(v)?),
        };

        let options = options_map
            .remove(&row.property_definition_id)
            .unwrap_or_default();

        result.push(EntityPropertyInfo {
            property_definition_id: row.property_definition_id,
            display_name: row.display_name,
            data_type: row.data_type,
            is_multi_select: row.is_multi_select,
            is_system: row.is_system,
            value,
            options,
        });
    }

    Ok(result)
}

/// Database row data for entity property with definition
struct EntityPropertyRow {
    entity_property_id: Uuid,
    entity_id: String,
    entity_type: EntityType,
    property_definition_id: Uuid,
    entity_property_created_at: chrono::DateTime<chrono::Utc>,
    entity_property_updated_at: chrono::DateTime<chrono::Utc>,
    definition_team_id: Option<Uuid>,
    definition_user_id: Option<String>,
    display_name: String,
    data_type: DataType,
    is_multi_select: bool,
    specific_entity_type: Option<Option<EntityType>>,
    definition_created_at: chrono::DateTime<chrono::Utc>,
    definition_updated_at: chrono::DateTime<chrono::Utc>,
    definition_is_system: bool,
    values: Option<sqlx::types::JsonValue>,
}

/// Helper to convert a database row into EntityPropertyWithDefinition
fn row_to_entity_property_with_definition(
    row: EntityPropertyRow,
) -> anyhow::Result<EntityPropertyWithDefinition> {
    let owner = models_properties::PropertyOwner::from_optional_ids(
        row.definition_team_id,
        row.definition_user_id,
        row.definition_is_system,
    );

    let property_definition = PropertyDefinition {
        id: row.property_definition_id,
        owner,
        display_name: row.display_name,
        data_type: row.data_type,
        is_multi_select: row.is_multi_select,
        specific_entity_type: row.specific_entity_type.flatten(),
        created_at: row.definition_created_at,
        updated_at: row.definition_updated_at,
        is_system: row.definition_is_system,
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
            anyhow::Error::from(e).context("failed to deserialize property value from JSONB")
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
    pool: &Pool<Postgres>,
    properties: &mut [EntityPropertyWithDefinition],
) -> anyhow::Result<()> {
    // Collect select-type property IDs for batch fetch
    let property_ids_needing_options: Vec<Uuid> = properties
        .iter()
        .filter(|p| {
            matches!(
                p.definition.data_type,
                DataType::SelectString | DataType::SelectNumber | DataType::Tag
            )
        })
        .map(|p| p.definition.id)
        .collect();

    // Fetch all options in one query (empty if no select properties)
    let options_map = if !property_ids_needing_options.is_empty() {
        property_option_queries::get_property_options_batch(pool, &property_ids_needing_options)
            .await?
    } else {
        HashMap::new()
    };

    // Process ALL properties
    for property in properties {
        let is_select_type = matches!(
            property.definition.data_type,
            DataType::SelectString | DataType::SelectNumber | DataType::Tag
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

/// Fetch and attach property options to properties across multiple entities in ONE query.
/// Optimized for bulk operations - collects all unique select-type property IDs across all entities,
/// fetches options once, then distributes to each property.
async fn attach_property_options_bulk(
    pool: &Pool<Postgres>,
    entity_properties_map: &mut HashMap<String, Vec<EntityPropertyWithDefinition>>,
) -> anyhow::Result<()> {
    let property_ids_needing_options: HashSet<Uuid> = entity_properties_map
        .values()
        .flatten()
        .filter(|p| {
            matches!(
                p.definition.data_type,
                DataType::SelectString | DataType::SelectNumber | DataType::Tag
            )
        })
        .map(|p| p.definition.id)
        .collect();

    let options_map = if !property_ids_needing_options.is_empty() {
        let property_ids_vec: Vec<Uuid> = property_ids_needing_options.into_iter().collect();
        property_option_queries::get_property_options_batch(pool, &property_ids_vec).await?
    } else {
        HashMap::new()
    };

    for properties in entity_properties_map.values_mut() {
        for property in properties.iter_mut() {
            let is_select_type = matches!(
                property.definition.data_type,
                DataType::SelectString | DataType::SelectNumber | DataType::Tag
            );
            if is_select_type {
                let options = options_map
                    .get(&property.definition.id)
                    .cloned()
                    .unwrap_or_default();
                validate_and_clean_select_option_value(property, &options);
                property.options = Some(options);
            } else {
                clear_stale_select_data(property);
            }
        }
    }

    Ok(())
}

/// Looks up an entity property by its ID.
/// Returns entity reference (for permissions) and definition ID (for required property check).
#[tracing::instrument(skip(pool))]
pub async fn lookup_entity_property(
    pool: &Pool<Postgres>,
    entity_property_id: Uuid,
) -> anyhow::Result<Option<EntityPropertyReference>> {
    let row = sqlx::query!(
        r#"
SELECT
    ep.entity_id,
    ep.entity_type as "entity_type: EntityType",
    ep.property_definition_id
FROM entity_properties ep
WHERE ep.id = $1
        "#,
        entity_property_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| EntityPropertyReference {
        entity_id: r.entity_id,
        entity_type: r.entity_type,
        property_definition_id: r.property_definition_id,
    }))
}

/// Gets entity properties with their definitions and values.
/// Includes both custom and system properties.
#[tracing::instrument(skip(pool))]
pub async fn get_entity_properties_values(
    pool: &Pool<Postgres>,
    entity_id: &str,
    entity_type: EntityType,
) -> anyhow::Result<Vec<EntityPropertyWithDefinition>> {
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
    pd.team_id as definition_team_id,
    pd.user_id as definition_user_id,
    pd.display_name,
    pd.data_type as "data_type: DataType",
    pd.is_multi_select,
    pd.specific_entity_type as "specific_entity_type: Option<EntityType>",
    pd.created_at as definition_created_at,
    pd.updated_at as definition_updated_at,
    pd.is_system as definition_is_system
FROM entity_properties ep
INNER JOIN property_definitions pd ON ep.property_definition_id = pd.id
WHERE ep.entity_id = $1 AND ep.entity_type = $2
        "#,
        entity_id,
        entity_type as EntityType
    )
    .fetch_all(pool)
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
                definition_team_id: row.definition_team_id,
                definition_user_id: row.definition_user_id,
                display_name: row.display_name,
                data_type: row.data_type,
                is_multi_select: row.is_multi_select,
                specific_entity_type: row.specific_entity_type,
                definition_created_at: row.definition_created_at,
                definition_updated_at: row.definition_updated_at,
                definition_is_system: row.definition_is_system,
                values: row.values,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;

    // Sort by display name
    sort_properties_by_display_name(&mut result);

    // Fetch and attach property options
    attach_property_options(pool, &mut result).await?;

    Ok(result)
}

/// Gets entity properties with their definitions and values for multiple entities.
/// Returns a HashMap where the key is the entity_id and the value is Vec<EntityPropertyWithDefinition>.
/// Includes both custom and system properties.
#[tracing::instrument(skip(pool))]
pub async fn get_bulk_entity_properties_values(
    pool: &Pool<Postgres>,
    entity_refs: &[EntityReference],
) -> anyhow::Result<HashMap<String, Vec<EntityPropertyWithDefinition>>> {
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
    pd.team_id as definition_team_id,
    pd.user_id as definition_user_id,
    pd.display_name,
    pd.data_type as "data_type: DataType",
    pd.is_multi_select,
    pd.specific_entity_type as "specific_entity_type: Option<EntityType>",
    pd.created_at as definition_created_at,
    pd.updated_at as definition_updated_at,
    pd.is_system as definition_is_system
FROM entity_properties ep
INNER JOIN property_definitions pd ON ep.property_definition_id = pd.id
WHERE (ep.entity_id, ep.entity_type) IN (
    SELECT * FROM UNNEST($1::TEXT[], $2::property_entity_type[])
)
"#,
        &entity_ids,
        &entity_types as &[EntityType]
    )
    .fetch_all(pool)
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
            definition_team_id: row.definition_team_id,
            definition_user_id: row.definition_user_id,
            display_name: row.display_name,
            data_type: row.data_type,
            is_multi_select: row.is_multi_select,
            specific_entity_type: row.specific_entity_type,
            definition_created_at: row.definition_created_at,
            definition_updated_at: row.definition_updated_at,
            definition_is_system: row.definition_is_system,
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

    attach_property_options_bulk(pool, &mut entity_properties_map).await?;

    // Ensure all requested entity_ids are present in the result, even if they have no properties
    for entity_ref in entity_refs {
        entity_properties_map
            .entry(entity_ref.entity_id.clone())
            .or_default();
    }

    Ok(entity_properties_map)
}

/// Gets entity properties with their definitions and values for multiple entities, filtered by property definition IDs.
/// Returns a HashMap where the key is the entity_id and the value is Vec<EntityPropertyWithDefinition>.
/// Only returns properties matching the specified property_ids. When `tag_viewer_user_id` is set,
/// also returns TAG properties whose definition is owned by that user or their team.
#[tracing::instrument(skip(pool))]
pub async fn get_bulk_entity_properties_values_filtered(
    pool: &Pool<Postgres>,
    entity_refs: &[EntityReference],
    property_ids: &[Uuid],
    tag_viewer_user_id: Option<&macro_user_id::user_id::MacroUserIdStr<'_>>,
) -> anyhow::Result<HashMap<String, Vec<EntityPropertyWithDefinition>>> {
    let tag_viewer_user_id: Option<&str> = tag_viewer_user_id.map(|u| u.as_ref());
    if entity_refs.is_empty() || (property_ids.is_empty() && tag_viewer_user_id.is_none()) {
        // If no property_ids specified, return empty map for each entity
        let mut result = HashMap::new();
        for entity_ref in entity_refs {
            result.insert(entity_ref.entity_id.clone(), Vec::new());
        }
        return Ok(result);
    }

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
    pd.team_id as definition_team_id,
    pd.user_id as definition_user_id,
    pd.display_name,
    pd.data_type as "data_type: DataType",
    pd.is_multi_select,
    pd.specific_entity_type as "specific_entity_type: Option<EntityType>",
    pd.created_at as definition_created_at,
    pd.updated_at as definition_updated_at,
    pd.is_system as definition_is_system
FROM entity_properties ep
INNER JOIN property_definitions pd ON ep.property_definition_id = pd.id
WHERE (ep.entity_id, ep.entity_type) IN (
    SELECT * FROM UNNEST($1::TEXT[], $2::property_entity_type[])
)
AND (
    pd.id = ANY($3::UUID[])
    OR (
        $4::text IS NOT NULL
        AND pd.data_type = $5
        AND (
            pd.user_id = $4
            OR pd.team_id IN (SELECT tu.team_id FROM team_user tu WHERE tu.user_id = $4)
        )
    )
)
        "#,
        &entity_ids,
        &entity_types as &[EntityType],
        &property_ids,
        tag_viewer_user_id,
        DataType::Tag as DataType
    )
    .fetch_all(pool)
    .await?;

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
            definition_team_id: row.definition_team_id,
            definition_user_id: row.definition_user_id,
            display_name: row.display_name,
            data_type: row.data_type,
            is_multi_select: row.is_multi_select,
            specific_entity_type: row.specific_entity_type,
            definition_created_at: row.definition_created_at,
            definition_updated_at: row.definition_updated_at,
            definition_is_system: row.definition_is_system,
            values: row.values,
        })?;

        entity_properties_map
            .entry(entity_id)
            .or_default()
            .push(property_with_definition);
    }

    for properties in entity_properties_map.values_mut() {
        sort_properties_by_display_name(properties);
    }

    attach_property_options_bulk(pool, &mut entity_properties_map).await?;

    for entity_ref in entity_refs {
        entity_properties_map
            .entry(entity_ref.entity_id.clone())
            .or_default();
    }

    Ok(entity_properties_map)
}

/// An entity property flattened into the shape the search index stores. Each
/// value lands under the field matching its type; the rest stay empty/None.
/// Covers every `PropertyValue` kind except multi-string.
#[derive(Default)]
pub struct IndexedEntityProperty {
    /// The property definition id this value belongs to.
    pub definition_id: String,
    /// Every equality-filterable value as a string: select-option UUIDs,
    /// entity-reference ids, links, text, bool as "true"/"false".
    pub values: Vec<String>,
    /// Numeric value (range + sort).
    pub number_value: Option<f64>,
    /// Date value as epoch milliseconds (range + sort).
    pub date_value: Option<i64>,
}

impl IndexedEntityProperty {
    fn is_empty(&self) -> bool {
        self.values.is_empty() && self.number_value.is_none() && self.date_value.is_none()
    }
}

/// Flatten one entity_properties row into the shape the search index stores.
/// Null and unparseable values yield None so one bad value can't fail the
/// whole index.
fn flatten_property_for_index(
    property_definition_id: Uuid,
    values: Option<serde_json::Value>,
) -> Option<IndexedEntityProperty> {
    let value = values?;
    if value.is_null() {
        return None;
    }
    let parsed = match serde_json::from_value::<PropertyValue>(value) {
        Ok(parsed) => parsed,
        Err(e) => {
            tracing::warn!(
                error = ?e,
                definition_id = %property_definition_id,
                "skipping unparseable property value for index"
            );
            return None;
        }
    };
    let mut property = IndexedEntityProperty {
        definition_id: property_definition_id.to_string(),
        ..Default::default()
    };
    match parsed {
        PropertyValue::SelectOption(ids) => {
            property.values = ids.into_iter().map(|id| id.to_string()).collect();
        }
        PropertyValue::EntityRef(refs) => {
            property.values = refs.into_iter().map(|r| r.entity_id).collect();
        }
        PropertyValue::Link(urls) => property.values = urls,
        PropertyValue::Str(s) => property.values = vec![s],
        PropertyValue::Bool(b) => property.values = vec![b.to_string()],
        PropertyValue::Num(n) => property.number_value = Some(n),
        PropertyValue::Date(d) => property.date_value = Some(d.timestamp_millis()),
    }
    if property.is_empty() {
        return None;
    }
    Some(property)
}

/// Fetch an entity's properties flattened for the search index. Each value
/// lands under the field matching its type (equality-filterable values as
/// strings, numbers, or epoch-millis dates); null and unparseable values are
/// skipped so one bad value can't fail the whole index.
#[tracing::instrument(skip(pool), err)]
pub async fn get_entity_properties_for_index(
    pool: &Pool<Postgres>,
    entity_id: &str,
    entity_type: EntityType,
) -> anyhow::Result<Vec<IndexedEntityProperty>> {
    let rows = sqlx::query!(
        r#"
        SELECT
            property_definition_id,
            values as "values: serde_json::Value"
        FROM entity_properties
        WHERE entity_id = $1
          AND entity_type = $2
        "#,
        entity_id,
        entity_type as EntityType,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| flatten_property_for_index(row.property_definition_id, row.values))
        .collect())
}

/// Page through the distinct entity ids that hold property rows of one
/// entity type, ordered by entity id so offset pagination is stable. Used by
/// the search properties backfill.
#[tracing::instrument(skip(pool), err)]
pub async fn get_entity_ids_with_properties(
    pool: &Pool<Postgres>,
    entity_type: EntityType,
    limit: i64,
    offset: i64,
) -> anyhow::Result<Vec<String>> {
    let rows = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT entity_id
        FROM entity_properties
        WHERE entity_type = $1
        ORDER BY entity_id
        LIMIT $2 OFFSET $3
        "#,
        entity_type as EntityType,
        limit,
        offset,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Batch variant of [`get_entity_properties_for_index`]: fetch the flattened
/// properties of many entities of one type in a single query, keyed by
/// entity id. Entities without properties are absent from the map.
#[tracing::instrument(skip(pool, entity_ids), err)]
pub async fn get_entity_properties_for_index_batch(
    pool: &Pool<Postgres>,
    entity_ids: &[String],
    entity_type: EntityType,
) -> anyhow::Result<HashMap<String, Vec<IndexedEntityProperty>>> {
    if entity_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = sqlx::query!(
        r#"
        SELECT
            entity_id,
            property_definition_id,
            values as "values: serde_json::Value"
        FROM entity_properties
        WHERE entity_id = ANY($1)
          AND entity_type = $2
        "#,
        entity_ids,
        entity_type as EntityType,
    )
    .fetch_all(pool)
    .await?;

    let mut result: HashMap<String, Vec<IndexedEntityProperty>> = HashMap::new();
    for row in rows {
        let Some(property) = flatten_property_for_index(row.property_definition_id, row.values)
        else {
            continue;
        };
        result.entry(row.entity_id).or_default().push(property);
    }

    Ok(result)
}
