use sqlx::{Pool, Postgres};

/// CI clones every test database from a `template1` that already holds the macrodb
/// schema (`just setup_test_template`). This test builds its own schema, so it
/// starts from an empty `public` schema.
const EMPTY_PUBLIC_SCHEMA: &str = "DROP SCHEMA public CASCADE; CREATE SCHEMA public;";

const MIGRATION: &str =
    include_str!("../../migrations/20261106205212_unfile_from_trashed_folders.sql");

#[sqlx::test(migrations = false)]
async fn migration_returns_items_in_trashed_folders_to_the_root(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sqlx::raw_sql(EMPTY_PUBLIC_SCHEMA).execute(&pool).await?;
    sqlx::raw_sql(
        r#"
        CREATE TABLE "Project" (id TEXT PRIMARY KEY, "deletedAt" TIMESTAMP);
        CREATE TABLE database_entities (
            database_id UUID PRIMARY KEY,
            project_id TEXT REFERENCES "Project"(id),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT '2024-01-01'
        );
        CREATE TABLE forms (
            id UUID PRIMARY KEY,
            project_id TEXT REFERENCES "Project"(id),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT '2024-01-01'
        );
        CREATE TABLE entity_access (
            entity_id UUID NOT NULL,
            entity_type TEXT NOT NULL,
            source_id TEXT NOT NULL,
            granted_from_project_id TEXT
        );

        INSERT INTO "Project" (id, "deletedAt") VALUES
            ('trashed', '2024-02-01'),
            ('live', NULL);
        INSERT INTO database_entities (database_id, project_id) VALUES
            ('00000000-0000-0000-0000-000000000001', 'trashed'),
            ('00000000-0000-0000-0000-000000000002', 'live');
        INSERT INTO forms (id, project_id) VALUES
            ('00000000-0000-0000-0000-000000000003', 'trashed');
        INSERT INTO entity_access (entity_id, entity_type, source_id, granted_from_project_id) VALUES
            ('00000000-0000-0000-0000-000000000001', 'database', 'inherited', 'trashed'),
            ('00000000-0000-0000-0000-000000000001', 'database', 'direct', NULL),
            ('00000000-0000-0000-0000-000000000002', 'database', 'inherited', 'live'),
            ('00000000-0000-0000-0000-000000000003', 'form', 'inherited', 'live');
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::raw_sql(MIGRATION).execute(&pool).await?;

    let folders = sqlx::query_as::<_, (String, Option<String>)>(
        r#"
        SELECT database_id::text, project_id FROM database_entities
        UNION ALL
        SELECT id::text, project_id FROM forms
        ORDER BY 1
        "#,
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(
        folders,
        vec![
            ("00000000-0000-0000-0000-000000000001".to_owned(), None),
            (
                "00000000-0000-0000-0000-000000000002".to_owned(),
                Some("live".to_owned())
            ),
            ("00000000-0000-0000-0000-000000000003".to_owned(), None),
        ]
    );

    let grants = sqlx::query_as::<_, (String, String)>(
        "SELECT entity_id::text, source_id FROM entity_access ORDER BY entity_id, source_id",
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(
        grants,
        vec![
            (
                "00000000-0000-0000-0000-000000000001".to_owned(),
                "direct".to_owned()
            ),
            (
                "00000000-0000-0000-0000-000000000002".to_owned(),
                "inherited".to_owned()
            ),
        ]
    );
    Ok(())
}
