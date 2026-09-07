use sqlx::{Pool, Postgres};

const MIGRATION: &str =
    include_str!("../migrations/20260825224506_unique_document_email_attachment_id.sql");
const SHARED_ATTACHMENT_ID: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_ATTACHMENT_ID: &str = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SOLO_ATTACHMENT_ID: &str = "cccccccc-cccc-cccc-cccc-cccccccccccc";

#[sqlx::test(migrations = false)]
async fn migration_keeps_one_link_per_attachment_and_leaves_documents(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    create_minimal_tables(&pool).await?;

    sqlx::query(
        r#"
        INSERT INTO "Document" (id, "deletedAt")
        VALUES
            ('aaa-deleted', NOW()),
            ('zzz-live', NULL),
            ('doc-b-1', NULL),
            ('doc-b-2', NULL),
            ('doc-solo', NULL)
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO document_email (document_id, email_attachment_id)
        VALUES
            ('aaa-deleted', $1),
            ('zzz-live', $1),
            ('doc-b-2', $2),
            ('doc-b-1', $2),
            ('doc-solo', $3)
        "#,
    )
    .bind(uuid::Uuid::parse_str(SHARED_ATTACHMENT_ID)?)
    .bind(uuid::Uuid::parse_str(OTHER_ATTACHMENT_ID)?)
    .bind(uuid::Uuid::parse_str(SOLO_ATTACHMENT_ID)?)
    .execute(&pool)
    .await?;

    sqlx::raw_sql(MIGRATION).execute(&pool).await?;

    let links = sqlx::query_as::<_, (String, uuid::Uuid)>(
        r#"
        SELECT document_id, email_attachment_id
        FROM document_email
        ORDER BY document_id
        "#,
    )
    .fetch_all(&pool)
    .await?;

    assert_eq!(
        links,
        vec![
            (
                "doc-b-1".to_owned(),
                uuid::Uuid::parse_str(OTHER_ATTACHMENT_ID)?,
            ),
            (
                "doc-solo".to_owned(),
                uuid::Uuid::parse_str(SOLO_ATTACHMENT_ID)?,
            ),
            (
                "zzz-live".to_owned(),
                uuid::Uuid::parse_str(SHARED_ATTACHMENT_ID)?,
            ),
        ]
    );

    let remaining_documents =
        sqlx::query_scalar::<_, String>(r#"SELECT id FROM "Document" ORDER BY id"#)
            .fetch_all(&pool)
            .await?;
    assert_eq!(
        remaining_documents,
        vec![
            "aaa-deleted".to_owned(),
            "doc-b-1".to_owned(),
            "doc-b-2".to_owned(),
            "doc-solo".to_owned(),
            "zzz-live".to_owned(),
        ]
    );

    let unique_index = sqlx::query_scalar::<_, String>(
        r#"
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'document_email'
          AND indexname = 'document_email_attachment_id_uq'
        "#,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(unique_index, "document_email_attachment_id_uq");

    let old_index = sqlx::query_scalar::<_, String>(
        r#"
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'document_email'
          AND indexname = 'idx_document_email_attachment_id'
        "#,
    )
    .fetch_optional(&pool)
    .await?;
    assert_eq!(old_index, None);

    Ok(())
}

async fn create_minimal_tables(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    sqlx::raw_sql(
        r#"
        CREATE TABLE "Document" (
            id text PRIMARY KEY,
            "deletedAt" timestamptz
        );

        CREATE TABLE document_email (
            document_id text NOT NULL,
            email_attachment_id uuid NOT NULL,
            PRIMARY KEY (document_id, email_attachment_id)
        );

        CREATE INDEX idx_document_email_attachment_id
            ON document_email (email_attachment_id);
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}
