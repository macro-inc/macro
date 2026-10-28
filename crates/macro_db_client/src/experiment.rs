use model::experiment::Experiment;

/// Gets all of the active experiments
#[tracing::instrument(skip(db))]
pub async fn get_active_experiments(
    db: &sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<Vec<Experiment>> {
    let experiments = sqlx::query_as!(
        Experiment,
        r#"
            SELECT e.id, e.active, e."started_at"::timestamptz as started_at, e."ended_at"::timestamptz as ended_at
            FROM "Experiment" e
            WHERE e.active = true
        "#,
    )
    .fetch_all(db)
    .await?;

    Ok(experiments)
}
