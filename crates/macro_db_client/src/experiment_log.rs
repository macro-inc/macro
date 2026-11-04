/// Initializes the experiments for a provided user
#[tracing::instrument(skip(db))]
pub async fn bulk_create_experiment_logs(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    experiment_ids: &[(String, String)],
) -> anyhow::Result<()> {
    let mut transaction = db.begin().await?;
    // Initialize the random number generator
    for (experiment_id, group) in experiment_ids {
        sqlx::query!(
            r#"
                INSERT INTO "ExperimentLog" (experiment_id, user_id, "group")
                VALUES ($1, $2, $3)
            "#,
            experiment_id,
            user_id,
            group,
        )
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;

    Ok(())
}
