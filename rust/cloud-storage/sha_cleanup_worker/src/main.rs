use std::sync::Arc;

use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
use sha_cleanup_worker::{config::Config, process::process, service};
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    MacroEntrypoint::default().init();

    let config = Config::from_env().context("all necessary env vars should be available")?;

    let s3_client = service::s3::S3::new(
        aws_sdk_s3::Client::new(
            &aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .load()
                .await,
        ),
        &config.document_storage_bucket,
    );

    tracing::trace!("initialized s3 client");

    let redis_client = service::redis::Redis::new(
        redis::cluster::ClusterClient::new(vec![config.redis_uri.as_str()])
            .expect("could not connect to redis client"),
    );
    redis_client.ping().context("able to ping redis")?;

    tracing::trace!("initialized redis client");

    let db = PgPoolOptions::new()
        .min_connections(1)
        .connect(&config.database_url)
        .await
        .context("could not connect to db")?;

    let db_client = service::db::DB::new(db);
    tracing::trace!("initialized db client");

    tracing::info!("initiating process");

    process(
        Arc::new(db_client),
        Arc::new(s3_client),
        Arc::new(redis_client),
    )
    .await
}
