use anyhow::Context;
use aws_lambda_events::s3::S3Event;
use lambda_runtime::{
    Error, LambdaEvent, run, service_fn,
    tracing::{self},
};
use macro_entrypoint::MacroEntrypoint;

mod handler;

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();

    tracing::trace!("initiating lambda");

    let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;

    let s3_client = s3_client::S3::new(aws_sdk_s3::Client::new(&aws_config));
    tracing::trace!("initialized s3 client");

    let sns_client = sns_client::SNS::new(aws_sdk_sns::Client::new(&aws_config));
    tracing::trace!("initialized sns client");

    let topic_arn = std::env::var("SNS_TOPIC_ARN").context("SNS_TOPIC_ARN is required")?;

    let shared_s3_client = &s3_client;
    let shared_sns_client = &sns_client;

    let func = service_fn(move |event: LambdaEvent<S3Event>| {
        let s3_client = shared_s3_client;
        let sns_client = shared_sns_client;
        let topic_arn = topic_arn.clone();
        async move { handler::handler(s3_client, sns_client, &topic_arn, event).await }
    });

    run(func).await
}
