use sqlx::PgPool;

#[tracing::instrument(err, skip(pool))]
pub(super) async fn touch_project_updated_at(
    pool: &PgPool,
    project_id: &str,
) -> Result<(), sqlx::Error> {
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
        |error: &sqlx::Error| {
            entity_access_db_utils::transaction_retry::is_transaction_conflict(error)
        },
    )
    .await
}
