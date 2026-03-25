//! Query to get all properties attached to an entity.

use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use models_properties::{DataType, EntityType};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

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
/// Results are sorted by display_name (case-insensitive).
#[tracing::instrument(skip(pool))]
pub async fn get_entity_properties(
    pool: &Pool<Postgres>,
    entity_id: &str,
    entity_type: EntityType,
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
        ORDER BY LOWER(pd.display_name)
        "#,
        entity_id,
        entity_type as EntityType,
    )
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    // Collect all property definition IDs that are select types to fetch options
    let select_prop_ids: Vec<Uuid> = rows
        .iter()
        .filter(|r| matches!(r.data_type, DataType::SelectString | DataType::SelectNumber))
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
