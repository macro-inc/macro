//! Property options update operations.

use crate::error::PropertiesDatabaseError;
use models_properties::db;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use sqlx::{Pool, Postgres};

type Result<T> = std::result::Result<T, PropertiesDatabaseError>;

/// Updates a property option's value, color, and display order in place.
///
/// The option id is preserved, so every entity referencing this option by id in its
/// `entity_properties.values` reflects the new value and color with no per-entity rewrite.
/// Returns `None` if no option with the given id exists.
#[tracing::instrument(skip(db), err)]
#[allow(
    clippy::disallowed_methods,
    reason = "runtime query mirrors property_options::get"
)]
pub async fn update_property_option(
    db: &Pool<Postgres>,
    option_id: uuid::Uuid,
    value: PropertyOptionValue,
    color: Option<String>,
    display_order: i32,
) -> Result<Option<PropertyOption>> {
    let (number_value, string_value) = value.to_db_values();

    let row = sqlx::query_as::<_, db::PropertyOption>(
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
    .fetch_optional(db)
    .await?;

    Ok(row.map(TryInto::try_into).transpose()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::property_options::get::get_property_option_by_id;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_update_property_option_renames_and_recolors(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let option_id = "10111111-1111-1111-1111-111111111111"
            .parse::<uuid::Uuid>()
            .unwrap();

        let updated = update_property_option(
            &pool,
            option_id,
            PropertyOptionValue::String("Lowest".to_string()),
            Some("#FF0000".to_string()),
            3,
        )
        .await?
        .expect("option should exist");

        // Same id, so every entity referencing it resolves the new value/color (propagation by id).
        assert_eq!(updated.id, option_id);
        assert_eq!(updated.color.as_deref(), Some("#FF0000"));
        assert_eq!(updated.display_order, 3);
        match &updated.value {
            PropertyOptionValue::String(s) => assert_eq!(s, "Lowest"),
            _ => panic!("expected string value"),
        }

        let fetched = get_property_option_by_id(&pool, option_id)
            .await?
            .expect("option should still exist");
        assert_eq!(fetched.color.as_deref(), Some("#FF0000"));

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_update_property_option_missing_returns_none(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let missing = "00000000-0000-0000-0000-000000000000"
            .parse::<uuid::Uuid>()
            .unwrap();

        let result = update_property_option(
            &pool,
            missing,
            PropertyOptionValue::String("x".to_string()),
            None,
            0,
        )
        .await?;
        assert!(result.is_none());

        Ok(())
    }
}
