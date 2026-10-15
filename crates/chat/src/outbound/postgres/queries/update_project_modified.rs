//! Bump a project's `updatedAt` timestamp.

/// Update a project's `updatedAt` to `NOW()`.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn update_project_modified(
    pool: &sqlx::PgPool,
    project_id: &str,
) -> anyhow::Result<()> {
    entity_access_db_utils::transaction_retry::on_conflict(
        || async {
            let mut transaction = pool.begin().await?;
            sqlx::query!(
                r#"UPDATE "Project" SET "updatedAt" = NOW() WHERE id = $1"#,
                project_id,
            )
            .execute(transaction.as_mut())
            .await?;

            source_items::sync_one(
                transaction.as_mut(),
                model_entity::EntityType::Project,
                project_id,
            )
            .await?;
            transaction.commit().await?;
            Ok(())
        },
        |error: &anyhow::Error| {
            entity_access_db_utils::transaction_retry::is_transaction_conflict(error.as_ref())
        },
    )
    .await
}
