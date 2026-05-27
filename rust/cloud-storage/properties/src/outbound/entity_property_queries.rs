//! General entity property query helpers.

use models_properties::EntityType;
use models_properties::service::property_value::PropertyValue;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

/// Atomically update a property value if the property is attached to the entity.
/// No-op if the property is not attached.
pub async fn update_entity_property_value_if_exists(
    pool: &Pool<Postgres>,
    entity_id: &str,
    entity_type: EntityType,
    property_definition_id: Uuid,
    value: Option<PropertyValue>,
) -> anyhow::Result<()> {
    // Serialize PropertyValue to JSONB (or NULL if None)
    let value_json = match value {
        Some(v) => serde_json::to_value(&v)?,
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
    .execute(pool)
    .await?;

    if result.rows_affected() > 0 {
        tracing::debug!("successfully updated entity property");
    } else {
        tracing::debug!("entity property not attached, no-op");
    }

    Ok(())
}

/// Upsert an entity property value (insert or update).
/// If the property doesn't exist, it will be created and attached to the entity.
/// If it exists, the value will be updated.
pub async fn upsert_entity_property(
    pool: &Pool<Postgres>,
    entity_id: &str,
    entity_type: EntityType,
    property_definition_id: Uuid,
    value: Option<PropertyValue>,
) -> anyhow::Result<()> {
    let id = macro_uuid::generate_uuid_v7();

    // Serialize PropertyValue to JSONB (or NULL if None)
    let value_json = match value {
        Some(v) => serde_json::to_value(&v)?,
        None => serde_json::Value::Null,
    };

    tracing::debug!(value_json = ?value_json, "upserting entity property");

    // Single UPSERT operation - handles both INSERT and UPDATE cases
    // When value is None, JSONB will be NULL, effectively clearing the value while keeping the property attached
    sqlx::query!(
        r#"
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (entity_id, entity_type, property_definition_id) 
        DO UPDATE SET 
            values = EXCLUDED.values,
            updated_at = NOW()
        "#,
        id,
        entity_id,
        entity_type as EntityType,
        property_definition_id,
        value_json
    )
    .execute(pool)
    .await?;

    tracing::debug!("successfully upserted entity property");

    Ok(())
}

/// Counts how many of the provided option IDs exist for the property definition.
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub async fn count_valid_property_options(
    pool: &Pool<Postgres>,
    property_definition_id: Uuid,
    option_ids: &[Uuid],
) -> anyhow::Result<i64> {
    let count: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) 
        FROM property_options 
        WHERE property_definition_id = $1
        AND id = ANY($2)
        "#,
    )
    .bind(property_definition_id)
    .bind(option_ids)
    .fetch_one(pool)
    .await?;

    Ok(count.0)
}
