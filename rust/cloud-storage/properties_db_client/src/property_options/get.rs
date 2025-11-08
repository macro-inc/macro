//! Property options get operations.

use crate::error::PropertiesDatabaseError;
use models_properties::db;
use models_properties::service::property_option::PropertyOption;
use sqlx::{Pool, Postgres};
use std::collections::HashMap;
use uuid::Uuid;

type Result<T> = std::result::Result<T, PropertiesDatabaseError>;

/// Gets a single property option by ID.
#[tracing::instrument(skip(db))]
pub async fn get_property_option_by_id(
    db: &Pool<Postgres>,
    option_id: uuid::Uuid,
) -> Result<Option<PropertyOption>> {
    let row = sqlx::query_as::<_, db::PropertyOption>(
        r#"
        SELECT 
            id,
            property_definition_id,
            display_order,
            number_value,
            string_value,
            created_at,
            updated_at
        FROM property_options 
        WHERE id = $1
        "#,
    )
    .bind(option_id)
    .fetch_optional(db)
    .await?;

    Ok(row.map(TryInto::try_into).transpose()?)
}

/// Gets all property options for a property definition.
#[tracing::instrument(skip(db))]
pub async fn get_property_options(
    db: &Pool<Postgres>,
    property_definition_id: uuid::Uuid,
) -> Result<Vec<PropertyOption>> {
    let rows = sqlx::query_as::<_, db::PropertyOption>(
        r#"
        SELECT 
            id,
            property_definition_id,
            display_order,
            number_value,
            string_value,
            created_at,
            updated_at
        FROM property_options 
        WHERE property_definition_id = $1
        ORDER BY display_order, number_value, LOWER(string_value)
        "#,
    )
    .bind(property_definition_id)
    .fetch_all(db)
    .await?;

    rows.into_iter()
        .map(|row| row.try_into().map_err(PropertiesDatabaseError::from))
        .collect()
}

/// Counts property options by their IDs.
#[tracing::instrument(skip(db))]
pub async fn count_property_options_by_ids(
    db: &Pool<Postgres>,
    property_definition_id: uuid::Uuid,
    property_option_ids: &[uuid::Uuid],
) -> Result<i64> {
    let count: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) 
        FROM property_options 
        WHERE property_definition_id = $1
        AND id = ANY($2)
        "#,
    )
    .bind(property_definition_id)
    .bind(property_option_ids)
    .fetch_one(db)
    .await?;

    Ok(count.0)
}

/// Gets property options for multiple properties in a single query.
/// Returns a HashMap where the key is property_definition_id and value is the list of options.
#[tracing::instrument(skip(db))]
pub async fn get_property_options_batch(
    db: &Pool<Postgres>,
    property_definition_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<PropertyOption>>> {
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
            created_at,
            updated_at
        FROM property_options 
        WHERE property_definition_id = ANY($1)
        ORDER BY property_definition_id, display_order, number_value, LOWER(string_value)
        "#,
    )
    .bind(property_definition_ids)
    .fetch_all(db)
    .await?;

    // Group options by property_definition_id
    let mut result: HashMap<Uuid, Vec<PropertyOption>> = HashMap::new();

    for row in rows {
        let property_id = row.property_definition_id;
        let service_option: PropertyOption = row.try_into()?;

        result.entry(property_id).or_default().push(service_option);
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_property_option_by_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let option_id = "10111111-1111-1111-1111-111111111111"
            .parse::<Uuid>()
            .unwrap();
        let option = get_property_option_by_id(&pool, option_id).await?;

        assert!(option.is_some());
        let option = option.unwrap();
        assert_eq!(option.display_order, 0);
        if let models_properties::service::property_option::PropertyOptionValue::String(val) =
            &option.value
        {
            assert_eq!(val, "Low");
        } else {
            panic!("Expected string value");
        }
        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_property_option_by_id_not_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let option_id = "00000000-0000-0000-0000-000000000000"
            .parse::<Uuid>()
            .unwrap();
        let option = get_property_option_by_id(&pool, option_id).await?;

        assert!(option.is_none());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_property_options(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<Uuid>()
            .unwrap();
        let options = get_property_options(&pool, property_id).await?;

        assert_eq!(options.len(), 4); // Priority has 4 options

        // Verify they are ordered by display_order
        assert_eq!(options[0].display_order, 0);
        assert_eq!(options[1].display_order, 1);
        assert_eq!(options[2].display_order, 2);
        assert_eq!(options[3].display_order, 3);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_property_options_string_values(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<Uuid>()
            .unwrap();
        let options = get_property_options(&pool, property_id).await?;

        // Verify string values
        if let models_properties::service::property_option::PropertyOptionValue::String(val) =
            &options[0].value
        {
            assert_eq!(val, "Low");
        } else {
            panic!("Expected string value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_property_options_number_values(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "44444444-4444-4444-4444-444444444444"
            .parse::<Uuid>()
            .unwrap(); // Score property
        let options = get_property_options(&pool, property_id).await?;

        assert_eq!(options.len(), 5);

        // Verify number values
        if let models_properties::service::property_option::PropertyOptionValue::Number(val) =
            options[0].value
        {
            assert_eq!(val, 4.0);
        } else {
            panic!("Expected number value");
        }

        if let models_properties::service::property_option::PropertyOptionValue::Number(val) =
            options[1].value
        {
            assert_eq!(val, 5.0);
        } else {
            panic!("Expected number value");
        }

        if let models_properties::service::property_option::PropertyOptionValue::Number(val) =
            options[2].value
        {
            assert_eq!(val, 3.0);
        } else {
            panic!("Expected number value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_property_options_empty(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "55555555-5555-5555-5555-555555555555"
            .parse::<Uuid>()
            .unwrap(); // Boolean property
        let options = get_property_options(&pool, property_id).await?;

        assert_eq!(options.len(), 0); // Boolean properties don't have options

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_count_property_options_by_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<Uuid>()
            .unwrap();
        let option_ids = vec![
            "10111111-1111-1111-1111-111111111111"
                .parse::<Uuid>()
                .unwrap(),
            "10111111-1111-1111-1111-111111111112"
                .parse::<Uuid>()
                .unwrap(),
        ];

        let count = count_property_options_by_ids(&pool, property_id, &option_ids).await?;

        assert_eq!(count, 2);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_count_property_options_by_ids_invalid(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<Uuid>()
            .unwrap();
        let option_ids = vec![
            "10111111-1111-1111-1111-111111111111"
                .parse::<Uuid>()
                .unwrap(),
            "00000000-0000-0000-0000-000000000000"
                .parse::<Uuid>()
                .unwrap(), // Invalid ID
        ];

        let count = count_property_options_by_ids(&pool, property_id, &option_ids).await?;

        assert_eq!(count, 1); // Only 1 valid option

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_property_options_batch(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_ids = vec![
            "11111111-1111-1111-1111-111111111111"
                .parse::<Uuid>()
                .unwrap(), // Priority: 4 options
            "44444444-4444-4444-4444-444444444444"
                .parse::<Uuid>()
                .unwrap(), // Score: 5 options
        ];

        let options_map = get_property_options_batch(&pool, &property_ids).await?;

        assert_eq!(options_map.len(), 2);
        assert_eq!(options_map.get(&property_ids[0]).unwrap().len(), 4);
        assert_eq!(options_map.get(&property_ids[1]).unwrap().len(), 5);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_property_options_batch_empty(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_ids: Vec<Uuid> = vec![];
        let options_map = get_property_options_batch(&pool, &property_ids).await?;

        assert_eq!(options_map.len(), 0);

        Ok(())
    }
}
