#[allow(
    warnings,
    reason = "RMME after PR https://github.com/macro-inc/macro-api/pull/1816"
)]
mod config;
mod context;
mod handler;
mod models;
mod service;
use std::sync::Arc;

use anyhow::Context;
use aws_lambda_events::event::s3::S3Event;
use config::Config;
use handler::handler;
use lambda_runtime::{
    Error, LambdaEvent, run, service_fn,
    tracing::{self},
};
use macro_entrypoint::MacroEntrypoint;
use macro_redis_cluster_client::Redis;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();

    tracing::trace!("initiating lambda");

    let config = Config::from_env().context("all necessary env vars should be available")?;

    tracing::trace!("initialized config");

    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(3)
        .connect(&config.database_url)
        .await
        .context("could not connect to db")?;

    tracing::trace!("initialized db connection");

    let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;

    let s3_client = s3_client::S3::new(aws_sdk_s3::Client::new(&aws_config));
    tracing::trace!("initialized s3 client");

    let lambda_client = lambda_client::Lambda::new(aws_sdk_lambda::Client::new(&aws_config));
    tracing::trace!("initialized lambda client");

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&aws_config))
        .convert_queue(&config.convert_queue);
    tracing::trace!("initialized sqs client");

    let redis_client = redis::cluster::ClusterClient::new(vec![config.redis_uri.clone()])
        .map_err(|e| anyhow::Error::msg(format!("unable to connect to redis {:?}", e)))
        .context("could not connect to redis client")?;
    if let Err(e) = redis_client.get_connection() {
        tracing::error!(error=?e, "unable to connect to redis");
        return Err(e.into());
    }
    let redis_client = Redis::new(redis_client);

    let context = context::Context {
        db,
        s3_client: Arc::new(s3_client),
        lambda_client: Arc::new(lambda_client),
        redis_client: Arc::new(redis_client),
        sqs_client: Arc::new(sqs_client),
        config,
    };

    let func = service_fn(move |event: LambdaEvent<S3Event>| {
        let context = context.clone();

        async move { handler(context, event).await }
    });

    run(func).await
}
