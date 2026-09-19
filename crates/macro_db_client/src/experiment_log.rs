use model::experiment::ExperimentLog;

/// Creates a new experiment log
#[tracing::instrument(skip(db))]
pub async fn create_experiment_log(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    experiment_id: &str,
    group: &str,
) -> anyhow::Result<ExperimentLog> {
    let experiment_log = sqlx::query_as!(
        ExperimentLog,
        r#"
            INSERT INTO "ExperimentLog" (experiment_id, user_id, "group")
            VALUES ($1, $2, $3)
            RETURNING experiment_id, user_id, "group" as experiment_group, completed
        "#,
        experiment_id,
        user_id,
        group,
    )
    .fetch_one(db)
    .await?;

    Ok(experiment_log)
}

/// Completes an experiment log
#[tracing::instrument(skip(db))]
pub async fn complete_experiment_log(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    experiment_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            UPDATE "ExperimentLog"
            SET completed = true
            WHERE user_id = $1 AND experiment_id = $2
        "#,
        user_id,
        experiment_id,
    )
    .fetch_one(db)
    .await?;

    Ok(())
}

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
