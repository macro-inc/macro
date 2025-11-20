//! Property option storage operations

use models_properties::service::property_option::PropertyOption;
use models_properties::service::property_option::PropertyOptionValue;
use sqlx::PgPool;
use uuid::Uuid;

use super::PropertiesStorageError;

pub async fn create_property_option(
    pool: &PgPool,
    option: PropertyOption,
) -> Result<PropertyOption, PropertiesStorageError> {
    let (number_value, string_value) = match &option.value {
        PropertyOptionValue::Number(n) => (Some(*n), None),
        PropertyOptionValue::String(s) => (None, Some(s.as_str())),
    };

    let row = sqlx::query!(
        r#"
        INSERT INTO property_options (
            id, property_definition_id, display_order, number_value, string_value
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, property_definition_id, display_order, number_value, string_value,
                  created_at, updated_at
        "#,
        option.id,
        option.property_definition_id,
        option.display_order,
        number_value,
        string_value,
    )
    .fetch_one(pool)
    .await?;

    let value = if let Some(num) = row.number_value {
        PropertyOptionValue::Number(num)
    } else if let Some(string) = row.string_value {
        PropertyOptionValue::String(string)
    } else {
        return Err(PropertiesStorageError::Parse(
            "Property option must have either number_value or string_value".to_string(),
        ));
    };

    Ok(PropertyOption {
        id: row.id,
        property_definition_id: row.property_definition_id,
        display_order: row.display_order,
        value,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

pub async fn get_property_options(
    pool: &PgPool,
    property_definition_id: Uuid,
) -> Result<Vec<PropertyOption>, PropertiesStorageError> {
    let rows = sqlx::query!(
        r#"
        SELECT id, property_definition_id, display_order, number_value, string_value,
               created_at, updated_at
        FROM property_options
        WHERE property_definition_id = $1
        ORDER BY display_order, number_value, LOWER(string_value)
        "#,
        property_definition_id,
    )
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            let value = if let Some(num) = row.number_value {
                PropertyOptionValue::Number(num)
            } else if let Some(string) = row.string_value {
                PropertyOptionValue::String(string)
            } else {
                return Err(PropertiesStorageError::Parse(
                    "Property option must have either number_value or string_value".to_string(),
                ));
            };

            Ok(PropertyOption {
                id: row.id,
                property_definition_id: row.property_definition_id,
                display_order: row.display_order,
                value,
                created_at: row.created_at,
                updated_at: row.updated_at,
            })
        })
        .collect()
}

pub async fn delete_property_option(
    pool: &PgPool,
    option_id: Uuid,
    property_definition_id: Uuid,
) -> Result<bool, PropertiesStorageError> {
    let result = sqlx::query!(
        r#"
        DELETE FROM property_options
        WHERE id = $1 AND property_definition_id = $2
        "#,
        option_id,
        property_definition_id,
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}
