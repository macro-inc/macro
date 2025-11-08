//! Property options insert operations.

use crate::error::PropertiesDatabaseError;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use sqlx::{Pool, Postgres};

type Result<T> = std::result::Result<T, PropertiesDatabaseError>;

/// Creates a new property option.
#[tracing::instrument(skip(db))]
pub async fn create_property_option(
    db: &Pool<Postgres>,
    property_definition_id: uuid::Uuid,
    display_order: i32,
    value: PropertyOptionValue,
) -> Result<PropertyOption> {
    let id = macro_uuid::generate_uuid_v7();
    let (number_value, string_value) = value.to_db_values();

    let row = sqlx::query!(
        r#"
        INSERT INTO property_options (
            id,
            property_definition_id,
            display_order,
            number_value,
            string_value
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, created_at, updated_at
        "#,
        id,
        property_definition_id,
        display_order,
        number_value,
        string_value
    )
    .fetch_one(db)
    .await?;

    Ok(PropertyOption {
        id: row.id,
        property_definition_id,
        display_order,
        value,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

/// Creates a property option within a transaction.
#[tracing::instrument(skip(tx))]
pub async fn create_property_option_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    property_definition_id: uuid::Uuid,
    display_order: i32,
    value: PropertyOptionValue,
) -> Result<()> {
    let id = macro_uuid::generate_uuid_v7();
    let (number_value, string_value) = value.to_db_values();

    sqlx::query!(
        r#"
        INSERT INTO property_options (
            id,
            property_definition_id,
            display_order,
            number_value,
            string_value
        )
        VALUES ($1, $2, $3, $4, $5)
        "#,
        id,
        property_definition_id,
        display_order,
        number_value,
        string_value
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::property_options::get::get_property_options;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_create_property_option_string(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<uuid::Uuid>()
            .unwrap();
        let value = PropertyOptionValue::String("Extra High".to_string());

        let options_before = get_property_options(&pool, property_id).await?;
        assert_eq!(options_before.len(), 4);

        let option = create_property_option(&pool, property_id, 4, value).await?;

        let options_after = get_property_options(&pool, property_id).await?;
        assert_eq!(options_after.len(), 5);

        assert_eq!(option.display_order, 4);
        assert_eq!(option.property_definition_id, property_id);

        if let PropertyOptionValue::String(val) = &option.value {
            assert_eq!(val, "Extra High");
        } else {
            panic!("Expected string value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_create_property_option_number(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "44444444-4444-4444-4444-444444444444"
            .parse::<uuid::Uuid>()
            .unwrap();
        let value = PropertyOptionValue::Number(10.5);

        let option = create_property_option(&pool, property_id, 99, value).await?;

        assert_eq!(option.display_order, 99);

        if let PropertyOptionValue::Number(val) = option.value {
            assert_eq!(val, 10.5);
        } else {
            panic!("Expected number value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_create_property_option_number_2(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "44444444-4444-4444-4444-444444444444"
            .parse::<uuid::Uuid>()
            .unwrap();
        let value = PropertyOptionValue::Number(3.5);

        let option = create_property_option(&pool, property_id, 0, value).await?;

        assert_eq!(option.display_order, 0);

        if let PropertyOptionValue::Number(val) = option.value {
            assert_eq!(val, 3.5);
        } else {
            panic!("Expected number value");
        }

        let options = get_property_options(&pool, property_id).await?;
        if let models_properties::service::property_option::PropertyOptionValue::Number(val) =
            options[0].value
        {
            assert_eq!(val, 3.5);
        } else {
            panic!("Expected number value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_create_property_option_duplicate_string_fails(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<uuid::Uuid>()
            .unwrap();
        let value = PropertyOptionValue::String("Low".to_string()); // Already exists

        let result = create_property_option(&pool, property_id, 4, value).await;

        assert!(result.is_err());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_create_property_option_duplicate_number_fails(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "44444444-4444-4444-4444-444444444444"
            .parse::<uuid::Uuid>()
            .unwrap();
        let value = PropertyOptionValue::Number(1.0); // Already exists

        let result = create_property_option(&pool, property_id, 5, value).await;

        assert!(result.is_err());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_create_property_option_invalid_property_fails(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "00000000-0000-0000-0000-000000000000"
            .parse::<uuid::Uuid>()
            .unwrap();
        let value = PropertyOptionValue::String("Test".to_string());

        let result = create_property_option(&pool, property_id, 0, value).await;

        assert!(result.is_err()); // Foreign key constraint violation

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_create_property_option_tx(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<uuid::Uuid>()
            .unwrap();
        let value = PropertyOptionValue::String("Test Option".to_string());

        let mut tx = pool.begin().await?;
        create_property_option_tx(&mut tx, property_id, 10, value).await?;
        tx.commit().await?;

        // Verify it was created
        let options =
            crate::property_options::get::get_property_options(&pool, property_id).await?;
        assert!(options.iter().any(|opt| {
            if let PropertyOptionValue::String(val) = &opt.value {
                val == "Test Option"
            } else {
                false
            }
        }));

        Ok(())
    }
}
