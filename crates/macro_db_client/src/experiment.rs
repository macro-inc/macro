use model::experiment::{Experiment, ExperimentOperation};

/// Creates a new experiment
#[tracing::instrument(skip(db))]
pub async fn create_experiment(
    db: &sqlx::Pool<sqlx::Postgres>,
    id: &str,
) -> anyhow::Result<Experiment> {
    let result = sqlx::query_as!(
        Experiment,
        r#"
            INSERT INTO "Experiment" (id)
            VALUES ($1)
            RETURNING id, active, "started_at"::timestamptz as started_at, "ended_at"::timestamptz as ended_at
        "#,
        id,
    )
    .fetch_one(db)
    .await?;

    Ok(result)
}

/// Updates an experiment to start/end it
#[tracing::instrument(skip(db))]
pub async fn patch_experiment(
    db: &sqlx::Pool<sqlx::Postgres>,
    id: &str,
    operation: ExperimentOperation,
) -> anyhow::Result<()> {
    match operation {
        ExperimentOperation::Start => {
            sqlx::query!(
                r#"
                    UPDATE "Experiment" SET active = true AND started_at = NOW() WHERE id = $1
                "#,
                id,
            )
            .execute(db)
            .await?;
        }
        ExperimentOperation::End => {
            sqlx::query!(
                r#"
                    UPDATE "Experiment" SET active = false AND ended_at = NOW() WHERE id = $1
                "#,
                id,
            )
            .execute(db)
            .await?;
        }
    }

    Ok(())
}

/// Deletes an experiment
#[tracing::instrument(skip(db))]
pub async fn delete_experiment(db: &sqlx::Pool<sqlx::Postgres>, id: &str) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            DELETE FROM "Experiment" WHERE id = $1
        "#,
        id,
    )
    .execute(db)
    .await?;

    Ok(())
}

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

/// Gets all of the users active experiments
#[tracing::instrument(skip(db))]
pub async fn get_active_experiments_for_user(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<Vec<Experiment>> {
    let experiments = sqlx::query_as!(
        Experiment,
        r#"
            SELECT e.id, e.active, e."started_at"::timestamptz as started_at, e."ended_at"::timestamptz as ended_at
            FROM "Experiment" e
            JOIN "ExperimentLog" el ON e.id = el.experiment_id
            WHERE el.user_id = $1 AND e.active = true
        "#,
        user_id,
    )
    .fetch_all(db)
    .await?;

    Ok(experiments)
}
