use std::time::Duration;

use super::*;

async fn project_updated_at(
    pool: &Pool<Postgres>,
    project_id: &str,
) -> anyhow::Result<chrono::DateTime<Utc>> {
    Ok(sqlx::query_scalar!(
        r#"SELECT "updatedAt"::timestamptz AS "updated_at!" FROM "Project" WHERE id = $1"#,
        project_id,
    )
    .fetch_one(pool)
    .await?)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn touch_project_updated_at_advances_stored_timestamp(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let project_id = "proj-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    let original_updated_at = project_updated_at(&pool, project_id).await?;

    tokio::time::sleep(Duration::from_millis(10)).await;
    EmailPgRepo::new(pool.clone())
        .touch_project_updated_at(project_id)
        .await?;

    let updated_at = project_updated_at(&pool, project_id).await?;
    assert!(updated_at > original_updated_at);

    Ok(())
}
