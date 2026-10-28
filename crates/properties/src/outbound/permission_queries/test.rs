use super::*;
use crate::outbound::{entity_properties_get_query, entity_property_queries};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_properties::service::property_value::PropertyValue;

const OWNER: &str = "macro|user1@test.com";
const DESCRIPTION_DEFINITION: Uuid = Uuid::from_u128(0x8888_8888_8888_8888_8888_8888_8888_8888);

/// A database with one table, placing the description definition, and one
/// row; returns `(database_id, row_id)`.
async fn insert_row(pool: &Pool<Postgres>) -> anyhow::Result<(Uuid, Uuid)> {
    let database_id = Uuid::now_v7();
    let table_id = Uuid::now_v7();
    let row_id = Uuid::now_v7();
    sqlx::query!(
        r#"WITH storage AS (INSERT INTO databases (id) VALUES ($1) RETURNING id)
           INSERT INTO database_entities (database_id, name, user_id) SELECT id, 'db', $2 FROM storage"#,
        database_id,
        OWNER,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, 't', 'a')"#,
        table_id,
        database_id,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO database_columns (id, table_id, property_definition_id, position) VALUES ($1, $2, $3, 'a')"#,
        Uuid::now_v7(),
        table_id,
        DESCRIPTION_DEFINITION,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO database_rows (id, table_id, position) VALUES ($1, $2, 'a')"#,
        row_id,
        table_id,
    )
    .execute(pool)
    .await?;
    Ok((database_id, row_id))
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("properties"))
)]
async fn database_row_owner_and_trash_come_from_its_database(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let (database_id, row_id) = insert_row(&pool).await?;

    let (owner, deleted) =
        get_owner_and_deleted(&pool, &row_id.to_string(), EntityType::DatabaseRow).await?;
    assert_eq!(owner, OWNER);
    assert!(!deleted);

    sqlx::query!(
        "UPDATE database_entities SET trashed_at = now() WHERE database_id = $1",
        database_id
    )
    .execute(&pool)
    .await?;
    let (_, deleted) =
        get_owner_and_deleted(&pool, &row_id.to_string(), EntityType::DatabaseRow).await?;
    assert!(deleted);

    assert!(
        get_owner_and_deleted(&pool, &Uuid::now_v7().to_string(), EntityType::DatabaseRow)
            .await
            .is_err()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("properties"))
)]
async fn database_row_cells_round_trip_through_entity_properties(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let (_, row_id) = insert_row(&pool).await?;
    let row_id = row_id.to_string();

    entity_property_queries::upsert_entity_property(
        &pool,
        &row_id,
        EntityType::DatabaseRow,
        DESCRIPTION_DEFINITION,
        Some(PropertyValue::Str("hello".to_string())),
    )
    .await?;

    let properties = entity_properties_get_query::get_entity_properties_values(
        &pool,
        &row_id,
        EntityType::DatabaseRow,
    )
    .await?;
    assert_eq!(properties.len(), 1);
    assert_eq!(properties[0].property.entity_type, EntityType::DatabaseRow);
    assert_eq!(
        properties[0].value,
        Some(PropertyValue::Str("hello".to_string()))
    );
    Ok(())
}
