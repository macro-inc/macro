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
