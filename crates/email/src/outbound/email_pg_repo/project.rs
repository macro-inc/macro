use sqlx::PgPool;

#[tracing::instrument(err, skip(pool))]
pub(super) async fn touch_project_updated_at(
    pool: &PgPool,
    project_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"UPDATE "Project" SET "updatedAt" = NOW() WHERE id = $1"#,
        project_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}
