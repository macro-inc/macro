use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{PgPool, Pool, Postgres};

const LINK_ID: &str = "00000000-0000-0000-0000-000000000001";
const THREAD_ID: &str = "10000000-0000-0000-0000-000000000001";

async fn insert_message(pool: &PgPool, replying_to_id: Option<Uuid>) -> anyhow::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_messages (id, link_id, thread_id, replying_to_id)
        VALUES ($1, $2, $3, $4)
        "#,
        id,
        Uuid::parse_str(LINK_ID)?,
        Uuid::parse_str(THREAD_ID)?,
        replying_to_id,
    )
    .execute(pool)
    .await?;
    Ok(id)
}

async fn row_version(pool: &PgPool, id: Uuid) -> anyhow::Result<String> {
    Ok(sqlx::query_scalar!(
        r#"SELECT xmin::text AS "xmin!" FROM email_messages WHERE id = $1"#,
        id
    )
    .fetch_one(pool)
    .await?)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn unchanged_replying_to_id_is_found_without_a_rewrite(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str(LINK_ID)?;
    let parent = insert_message(&pool, None).await?;
    let reply = insert_message(&pool, Some(parent)).await?;
    let before = row_version(&pool, reply).await?;

    let found = update_db_message_replying_to_id(&pool, link_id, reply, Some(parent)).await?;

    assert!(found);
    assert_eq!(row_version(&pool, reply).await?, before);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn changed_replying_to_id_is_written(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str(LINK_ID)?;
    let parent = insert_message(&pool, None).await?;
    let reply = insert_message(&pool, None).await?;

    let found = update_db_message_replying_to_id(&pool, link_id, reply, Some(parent)).await?;

    assert!(found);
    let stored = sqlx::query_scalar!(
        r#"SELECT replying_to_id FROM email_messages WHERE id = $1"#,
        reply
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(stored, Some(parent));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn missing_message_is_not_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str(LINK_ID)?;
    let parent = insert_message(&pool, None).await?;

    let found =
        update_db_message_replying_to_id(&pool, link_id, Uuid::now_v7(), Some(parent)).await?;

    assert!(!found);
    Ok(())
}
