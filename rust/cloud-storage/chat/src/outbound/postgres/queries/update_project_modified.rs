//! Bump a project's `updatedAt` timestamp.

/// Update a project's `updatedAt` to `NOW()`.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn update_project_modified(
    pool: &sqlx::PgPool,
    project_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"UPDATE "Project" SET "updatedAt" = NOW() WHERE id = $1"#,
        project_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}
