//! General entity property query helpers.

use models_properties::service::property_value::PropertyValue;
use models_properties::{EntityReference, EntityType};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

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

/// Atomically add one option to a multi-select entity property value, creating
/// the row if the property is not yet attached. Re-adding a present option is a
/// no-op (deduped). The whole change is one row-locked statement applied to the
/// current stored value, so concurrent adds merge instead of one overwriting
/// the other (no read-modify-write lost update). A NULL or non-SelectOption
/// existing value is coerced to a single-element SelectOption.
pub async fn add_entity_property_option(
    pool: &Pool<Postgres>,
    entity_id: &str,
    entity_type: EntityType,
    property_definition_id: Uuid,
    option_id: Uuid,
) -> anyhow::Result<()> {
    let id = macro_uuid::generate_uuid_v7();

    sqlx::query!(
        r#"
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        VALUES (
            $1, $2, $3, $4,
            jsonb_build_object('type', 'SelectOption', 'value', jsonb_build_array($5::text))
        )
        ON CONFLICT (entity_id, entity_type, property_definition_id)
        DO UPDATE SET
            values = CASE
                WHEN entity_properties.values ->> 'type' = 'SelectOption'
                     AND entity_properties.values -> 'value' @> jsonb_build_array($5::text)
                    THEN entity_properties.values
                WHEN entity_properties.values ->> 'type' = 'SelectOption'
                    THEN jsonb_set(
                            entity_properties.values,
                            '{value}',
                            (entity_properties.values -> 'value') || jsonb_build_array($5::text)
                        )
                ELSE jsonb_build_object('type', 'SelectOption', 'value', jsonb_build_array($5::text))
            END,
            updated_at = NOW()
        "#,
        id,
        entity_id,
        entity_type as EntityType,
        property_definition_id,
        option_id.to_string(),
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Atomically remove one option from a multi-select entity property value. A
/// no-op if the property is unattached or the option is not present. One
/// row-locked statement applied to the current stored value, so it composes
/// with concurrent adds/removes without a lost update.
pub async fn remove_entity_property_option(
    pool: &Pool<Postgres>,
    entity_id: &str,
    entity_type: EntityType,
    property_definition_id: Uuid,
    option_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE entity_properties
        SET values = jsonb_set(
                values,
                '{value}',
                COALESCE(
                    (
                        SELECT jsonb_agg(elem)
                        FROM jsonb_array_elements(values -> 'value') AS elem
                        WHERE elem <> to_jsonb($4::text)
                    ),
                    '[]'::jsonb
                )
            ),
            updated_at = NOW()
        WHERE entity_id = $1
          AND entity_type = $2
          AND property_definition_id = $3
          AND values ->> 'type' = 'SelectOption'
          AND values -> 'value' @> jsonb_build_array($4::text)
        "#,
        entity_id,
        entity_type as EntityType,
        property_definition_id,
        option_id.to_string(),
    )
    .execute(pool)
    .await?;

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

/// Deletes an entity property by its ID.
#[tracing::instrument(skip(pool))]
pub async fn delete_entity_property(
    pool: &Pool<Postgres>,
    entity_property_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        "DELETE FROM entity_properties WHERE id = $1",
        entity_property_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Deletes all properties attached to an entity.
#[tracing::instrument(skip(pool))]
pub async fn delete_entity_properties(
    pool: &Pool<Postgres>,
    entity_reference: &EntityReference,
) -> anyhow::Result<()> {
    sqlx::query!(
        "DELETE FROM entity_properties WHERE entity_id = $1 AND entity_type = $2",
        entity_reference.entity_id,
        entity_reference.entity_type as _,
    )
    .execute(pool)
    .await?;

    Ok(())
}
