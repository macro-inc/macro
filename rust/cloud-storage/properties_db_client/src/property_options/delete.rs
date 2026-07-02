//! Property options delete operations.

use crate::error::PropertiesDatabaseError;
use sqlx::{Pool, Postgres};

type Result<T> = std::result::Result<T, PropertiesDatabaseError>;

/// Deletes a property option and strips its id from every entity value that
/// references it, atomically. Without the cleanup a stored value keeps the
/// dead id and a later set-value that echoes the full id list fails option
/// validation.
/// Returns Ok(true) if the option was deleted, Ok(false) if it didn't exist.
#[tracing::instrument(skip(db))]
pub async fn delete_property_option(
    db: &Pool<Postgres>,
    property_definition_id: uuid::Uuid,
    property_option_id: uuid::Uuid,
) -> Result<bool> {
    let mut tx = db.begin().await?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use models_properties::EntityType;
    use models_properties::service::property_option::PropertyOptionValue;
    use models_properties::service::property_value::PropertyValue;
    use sqlx::{Pool, Postgres};
    use uuid::Uuid;

    const PRIORITY_PROPERTY_ID: &str = "11111111-1111-1111-1111-111111111111";
    const PRIORITY_OPTION_LOW: &str = "10111111-1111-1111-1111-111111111111";
    const PRIORITY_OPTION_MEDIUM: &str = "10111111-1111-1111-1111-111111111112";
    const PRIORITY_OPTION_HIGH: &str = "10111111-1111-1111-1111-111111111113";
    const PRIORITY_OPTION_URGENT: &str = "10111111-1111-1111-1111-111111111114";

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_delete_property_option(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = PRIORITY_PROPERTY_ID.parse::<Uuid>().unwrap();
        let option_id = PRIORITY_OPTION_LOW.parse::<Uuid>().unwrap();

        // Verify it exists
        let option_before =
            crate::property_options::get::get_property_option_by_id(&pool, option_id).await?;
        assert!(option_before.is_some());

        // Delete it
        let deleted = delete_property_option(&pool, property_id, option_id).await?;
        assert!(deleted);

        // Verify it's gone
        let option_after =
            crate::property_options::get::get_property_option_by_id(&pool, option_id).await?;
        assert!(option_after.is_none());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_delete_nonexistent_property_option(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = PRIORITY_PROPERTY_ID.parse::<Uuid>().unwrap();
        let option_id = "00000000-0000-0000-0000-000000000000"
            .parse::<Uuid>()
            .unwrap();

        // Deleting non-existent option should return false
        let deleted = delete_property_option(&pool, property_id, option_id).await?;
        assert!(!deleted);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_delete_property_option_reduces_count(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = PRIORITY_PROPERTY_ID.parse::<Uuid>().unwrap();
        let option_id = PRIORITY_OPTION_LOW.parse::<Uuid>().unwrap();

        // Get initial count
        let options_before =
            crate::property_options::get::get_property_options(&pool, property_id).await?;
        let count_before = options_before.len();

        // Delete one option
        delete_property_option(&pool, property_id, option_id).await?;

        // Verify count decreased
        let options_after =
            crate::property_options::get::get_property_options(&pool, property_id).await?;
        let count_after = options_after.len();

        assert_eq!(count_after, count_before - 1);

        Ok(())
    }

    /// Reproduces the dangling-option bug: an entity value referencing
    /// [A, B, C, D] must drop D once option D is deleted, so a later set-value
    /// echoing the surviving ids passes option validation.
    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_delete_property_option_strips_value_references(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = PRIORITY_PROPERTY_ID.parse::<Uuid>().unwrap();
        let opt_a = PRIORITY_OPTION_LOW.parse::<Uuid>().unwrap();
        let opt_b = PRIORITY_OPTION_MEDIUM.parse::<Uuid>().unwrap();
        let opt_c = PRIORITY_OPTION_HIGH.parse::<Uuid>().unwrap();
        let opt_d = PRIORITY_OPTION_URGENT.parse::<Uuid>().unwrap();

        // Entity selects all four options.
        crate::entity_properties::upsert::upsert_entity_property_values(
            &pool,
            "doc_cascade",
            EntityType::Document,
            property_id,
            Some(PropertyValue::SelectOption(vec![
                opt_a, opt_b, opt_c, opt_d,
            ])),
        )
        .await?;

        // A new option created after selection (the "new tag" in the repro).
        let opt_e = crate::property_options::insert::create_property_option(
            &pool,
            property_id,
            4,
            PropertyOptionValue::String("New".to_string()),
            None,
        )
        .await?
        .id;

        // Delete option D.
        let deleted = delete_property_option(&pool, property_id, opt_d).await?;
        assert!(deleted);

        // Read the raw stored value (bypassing the read-path cleaner) to prove
        // the dangling id is gone from storage, not just filtered on read.
        let raw: Option<serde_json::Value> = sqlx::query_scalar!(
            r#"
            SELECT values as "values: serde_json::Value"
            FROM entity_properties
            WHERE entity_id = $1 AND entity_type = $2 AND property_definition_id = $3
            "#,
            "doc_cascade",
            EntityType::Document as EntityType,
            property_id,
        )
        .fetch_one(&pool)
        .await?;

        let stored: PropertyValue = serde_json::from_value(raw.expect("value present"))?;
        let PropertyValue::SelectOption(ids) = stored else {
            panic!("expected SelectOption");
        };
        assert_eq!(ids, vec![opt_a, opt_b, opt_c]);

        // The surviving selection plus the new option all validate, so the
        // set-value that previously 400'd now succeeds.
        let valid = crate::property_options::get::count_property_options_by_ids(
            &pool,
            property_id,
            &[opt_a, opt_b, opt_c, opt_e],
        )
        .await?;
        assert_eq!(valid, 4);

        Ok(())
    }
}
