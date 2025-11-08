use std::sync::Arc;

use anyhow::Context;
use aws_lambda_events::event::eventbridge::EventBridgeEvent;
use lambda_runtime::{
    run, service_fn,
    tracing::{self, subscriber::EnvFilter},
    Error, LambdaEvent,
};
use sqlx::{postgres::PgPoolOptions, Pool, Postgres};
use table_cleanup_handler::config::Config;

#[tracing::instrument(skip(db))]
async fn handler(db: Pool<Postgres>, table_name: &str, max_age_hours: u8) -> anyhow::Result<()> {
    tracing::info!("processing event");
    let query = format!(
        "DELETE FROM \"{}\" WHERE \"createdAt\" < NOW() - INTERVAL '{} hours'",
        table_name, max_age_hours
    );
    let query = sqlx::query(&query);
    let result = query.execute(&db).await?;
    tracing::info!(rows_affected=?result.rows_affected(), "cleanup complete");
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    dotenv::dotenv().ok();

    tracing::subscriber::fmt()
        .with_line_number(true)
        .json()
        .with_env_filter(EnvFilter::from_default_env())
        .with_current_span(true) // Include current span in formatted events
        .with_span_list(false) // Disable nesting all spans
        .flatten_event(true) // Flattens event fields.init();
        .init();
    tracing::info!("initiating lambda");

    let config = Config::from_env().context("all necessary env vars should be available")?;

    tracing::trace!("initialized config");

    // We should only ever need 1 connection
    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(1)
        .connect(&config.database_url)
        .await
        .context("could not connect to db")?;

    // Shared references
    let shared_config = Arc::new(config);

    let func = service_fn(
        // we don't actually care about the event bridge event here
        move |_event: LambdaEvent<EventBridgeEvent<serde_json::Value>>| {
            let config = shared_config.clone();
            let db = db.clone();

            async move { handler(db, config.table_name.as_str(), config.max_age_hours).await }
        },
    );

    run(func).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../fixtures", scripts("basic_test")))]
    async fn test_handler(pool: Pool<Postgres>) {
        sqlx::query!(
            r#"
            INSERT INTO "JobToDocumentProcessResult" ("jobId", "documentProcessResultId", "createdAt")
            VALUES ('test-1', 1, '9999-12-16 00:00:00'),
            ('test-2', 1, '1998-08-26 00:00:00')
        "#
        )
        .execute(&pool)
        .await
        .unwrap();

        handler(pool.clone(), "JobToDocumentProcessResult", 2)
            .await
            .unwrap();

        let rest = sqlx::query!(
            r#"
                SELECT "jobId" as job_id FROM "JobToDocumentProcessResult"
            "#
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        let mut result = rest
            .iter()
            .map(|r| r.job_id.as_str())
            .collect::<Vec<&str>>();
        result.sort();
        assert_eq!(result, vec!["test-1"]);
    }
}
