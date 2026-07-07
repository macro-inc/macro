//! Property option query helpers.

use std::collections::HashMap;

use models_properties::db;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::domain::model::UpdatePropertyOptionOutcome;

/// Gets a single property option by ID.
#[tracing::instrument(skip(pool))]
#[allow(
    clippy::disallowed_methods,
    reason = "runtime query keeps test builds offline-friendly"
)]
pub async fn get_property_option(
    pool: &Pool<Postgres>,
    option_id: Uuid,
) -> anyhow::Result<Option<PropertyOption>> {
    let row = sqlx::query_as::<_, db::PropertyOption>(
        r#"
        SELECT 
            id,
            property_definition_id,
            display_order,
            number_value,
            string_value,
            color,
            created_at,
            updated_at
        FROM property_options 
        WHERE id = $1
        "#,
    )
    .bind(option_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(TryInto::try_into).transpose()?)
}

/// Gets all property options for a property definition, ordered for display.
#[tracing::instrument(skip(pool))]
#[allow(
    clippy::disallowed_methods,
    reason = "runtime query keeps test builds offline-friendly"
)]
pub async fn get_property_options(
    pool: &Pool<Postgres>,
    property_definition_id: Uuid,
) -> anyhow::Result<Vec<PropertyOption>> {
    let rows = sqlx::query_as::<_, db::PropertyOption>(
        r#"
        SELECT 
            id,
            property_definition_id,
            display_order,
            number_value,
            string_value,
            color,
            created_at,
            updated_at
        FROM property_options 
        WHERE property_definition_id = $1
        ORDER BY display_order, number_value, LOWER(string_value)
        "#,
    )
    .bind(property_definition_id)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| row.try_into().map_err(anyhow::Error::from))
        .collect()
}

/// Gets property options for multiple properties in a single query.
/// Returns a HashMap where the key is property_definition_id and value is the list of options.
#[tracing::instrument(skip(pool))]
#[allow(
    clippy::disallowed_methods,
    reason = "runtime query keeps test builds offline-friendly"
)]
pub async fn get_property_options_batch(
    pool: &Pool<Postgres>,
    property_definition_ids: &[Uuid],
) -> anyhow::Result<HashMap<Uuid, Vec<PropertyOption>>> {
    if property_definition_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query_as::<_, db::PropertyOption>(
        r#"
        SELECT 
            id,
            property_definition_id,
            display_order,
            number_value,
            string_value,
            color,
            created_at,
            updated_at
        FROM property_options 
        WHERE property_definition_id = ANY($1)
        ORDER BY property_definition_id, display_order, number_value, LOWER(string_value)
        "#,
    )
    .bind(property_definition_ids)
    .fetch_all(pool)
    .await?;

    // Group options by property_definition_id
    let mut result: HashMap<Uuid, Vec<PropertyOption>> = HashMap::new();
    for row in rows {
        let option: PropertyOption = row.try_into()?;
        result
            .entry(option.property_definition_id)
            .or_default()
            .push(option);
    }

    Ok(result)
}

/// Creates a new property option.
#[tracing::instrument(skip(pool))]
pub async fn create_property_option(
    pool: &Pool<Postgres>,
    property_definition_id: Uuid,
    display_order: i32,
    value: PropertyOptionValue,
    color: Option<String>,
) -> anyhow::Result<PropertyOption> {
    let id = macro_uuid::generate_uuid_v7();
    let (number_value, string_value) = value.to_db_values();

    let row = sqlx::query!(
        r#"
        INSERT INTO property_options (
            id,
            property_definition_id,
            display_order,
            number_value,
            string_value,
            color
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, created_at, updated_at
        "#,
        id,
        property_definition_id,
        display_order,
        number_value,
        string_value,
        color.clone()
    )
    .fetch_one(pool)
    .await?;

    Ok(PropertyOption {
        id: row.id,
        property_definition_id,
        display_order,
        value,
        color,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

/// Updates a property option's value, color, and display order in place.
///
/// The option id is preserved, so every entity referencing this option by id in its
/// `entity_properties.values` reflects the new value and color with no per-entity rewrite.
#[tracing::instrument(skip(pool), err)]
#[allow(
    clippy::disallowed_methods,
    reason = "runtime query mirrors get_property_option"
)]
pub async fn update_property_option(
    pool: &Pool<Postgres>,
    option_id: Uuid,
    value: PropertyOptionValue,
    color: Option<String>,
    display_order: i32,
) -> anyhow::Result<UpdatePropertyOptionOutcome> {
    let (number_value, string_value) = value.to_db_values();

    let result = sqlx::query_as::<_, db::PropertyOption>(
        r#"
        UPDATE property_options
        SET number_value = $2,
            string_value = $3,
            color = $4,
            display_order = $5,
            updated_at = NOW()
        WHERE id = $1
        RETURNING
            id,
            property_definition_id,
            display_order,
            number_value,
            string_value,
            color,
            created_at,
            updated_at
        "#,
    )
    .bind(option_id)
    .bind(number_value)
    .bind(string_value)
    .bind(color)
    .bind(display_order)
    .fetch_optional(pool)
    .await;

    match result {
        Ok(Some(row)) => Ok(UpdatePropertyOptionOutcome::Updated(row.try_into()?)),
        Ok(None) => Ok(UpdatePropertyOptionOutcome::NotFound),
        Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
            Ok(UpdatePropertyOptionOutcome::DuplicateValue)
        }
        Err(e) => Err(e.into()),
    }
}

/// Deletes a property option and strips its id from every entity value that
/// references it, atomically. Without the cleanup a stored value keeps the
/// dead id and a later set-value that echoes the full id list fails option
/// validation.
/// Returns Ok(true) if the option was deleted, Ok(false) if it didn't exist.
#[tracing::instrument(skip(pool))]
pub async fn delete_property_option(
    pool: &Pool<Postgres>,
    property_definition_id: Uuid,
    property_option_id: Uuid,
) -> anyhow::Result<bool> {
    let mut tx = pool.begin().await?;

    sqlx::query!(
        r#"
        UPDATE entity_properties
        SET
            values = jsonb_set(
                values,
                '{value}',
                COALESCE(
                    (
                        SELECT jsonb_agg(elem)
                        FROM jsonb_array_elements(values -> 'value') AS elem
                        WHERE elem <> to_jsonb($2::text)
                    ),
                    '[]'::jsonb
                )
            ),
            updated_at = NOW()
        WHERE property_definition_id = $1
          AND values @> jsonb_build_object('value', jsonb_build_array($2::text))
        "#,
        property_definition_id,
        property_option_id.to_string(),
    )
    .execute(&mut *tx)
    .await?;

    let result = sqlx::query!(
        "DELETE FROM property_options WHERE id = $1",
        property_option_id
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(result.rows_affected() > 0)
}
