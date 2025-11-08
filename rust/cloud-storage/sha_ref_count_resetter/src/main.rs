use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
use sha_ref_count_resetter::service;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let database_url =
        std::env::var("DATABASE_URL").context("DATABASE_URL needs to be provided")?;

    let db = PgPoolOptions::new()
        .min_connections(5)
        .max_connections(25)
        .connect(&database_url)
        .await
        .context("could not connect to db")?;

    tracing::trace!("initialized db connection");

    let redis_uri = std::env::var("REDIS_URI").context("REDIS_URI needs to be provided")?;

    // Redis handles it own connection pool internally. Each time we use redis
    // we should be using redis_client.get_connection() to grab a specific connection
    let redis_client = redis::cluster::ClusterClient::new(vec![redis_uri.as_str()])
        .context("could not connect to redis")?;

    if let Err(e) = redis_client.get_connection() {
        tracing::error!("unable to connect to redis");
        return Err(e.into());
    }

    let redis_client = service::redis::Redis::new(redis_client);
    tracing::trace!("initialized redis connection");

    // Get shas
    let shas = service::db::get_shas(db.clone()).await?;
    tracing::info!(shas=?shas.len(), "shas retrieved");

    if let Err(e) = redis_client.set_shas(shas).await {
        tracing::error!(error=?e, "unable to set shas");
        return Err(e);
    }

    tracing::info!("shas updated");

    Ok(())
}
