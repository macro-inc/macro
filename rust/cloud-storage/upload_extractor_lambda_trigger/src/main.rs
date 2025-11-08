use std::sync::Arc;

use anyhow::Context;
use aws_config::{Region, meta::region::RegionProviderChain};
use aws_lambda_events::event::eventbridge::EventBridgeEvent;
use dynamodb_client::DynamodbClient;
use lambda_runtime::{
    Error, LambdaEvent, run, service_fn,
    tracing::{self},
};
use macro_entrypoint::MacroEntrypoint;
use models_bulk_upload::UploadFolderStatus;
use serde::{Deserialize, Serialize};

// see: https://docs.aws.amazon.com/AmazonS3/latest/userguide/ev-events.html
#[derive(Debug, Serialize, Deserialize)]
struct S3CreateObjectDetail {
    bucket: Bucket,
    object: Object,
}

#[derive(Debug, Serialize, Deserialize)]
struct Bucket {
    name: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Object {
    key: String,
}

#[tracing::instrument(skip_all)]
async fn handler(
    dynamodb_client: Arc<DynamodbClient>,
    sqs_client: Arc<sqs_client::SQS>,
    event: LambdaEvent<EventBridgeEvent<S3CreateObjectDetail>>,
) -> Result<(), Error> {
    let key = event.payload.detail.object.key;

    if !key.starts_with("extract/") {
        tracing::warn!("Skipping object that doesn't start with extract/: {}", key);
        return Err(Error::from(
            "Skipping object that doesn't start with extract/: {}",
        ));
    }

    let upload_request_id = key.trim_start_matches("extract/");

    tracing::info!("Processing request: {}", upload_request_id);

    let bulk_upload_request = dynamodb_client
        .bulk_upload
        .get_bulk_upload_request(upload_request_id)
        .await
        .inspect_err(|e| tracing::error!("Failed to get request info: {:?}", e))?;

    tracing::info!(
        "Received request info from dynamodb {:?}",
        bulk_upload_request
    );

    dynamodb_client
        .bulk_upload
        .update_bulk_upload_request_status(
            &bulk_upload_request.request_id,
            UploadFolderStatus::Uploaded,
            None,
            None,
        )
        .await
        .inspect_err(|e| tracing::error!("Failed to update status: {:?}", e))?;

    tracing::info!("Updated upload status for request {}", upload_request_id);

    sqs_client
        .enqueue_upload_extractor_unzip(
            upload_request_id,
            key.as_str(),
            bulk_upload_request.user_id.as_str(),
            &bulk_upload_request.name,
            &bulk_upload_request.parent_id,
        )
        .await
        .inspect_err(|e| tracing::error!("Failed to enqueue job: {:?}", e))?;

    tracing::info!("Finished processing request {}", upload_request_id);

    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();
    tracing::info!("initiating lambda");

    let dynamo_table_name =
        std::env::var("DYNAMODB_TABLE").context("DYNAMODB_TABLE must be set")?;
    let upload_extract_queue =
        std::env::var("UPLOAD_EXTRACTOR_QUEUE").context("UPLOAD_EXTRACTOR_QUEUE must be set")?;

    tracing::trace!("initialized env vars");

    let region_provider = RegionProviderChain::default_provider().or_else(Region::new("us-east-1"));
    let config = aws_config::from_env().region(region_provider).load().await;
    let dynamodb_client = DynamodbClient::new(&config, None, Some(dynamo_table_name.clone()));

    tracing::trace!("initialized dynamodb client");

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&config))
        .upload_extractor_queue(&upload_extract_queue);

    tracing::trace!("initialized sqs client");

    // Shared references
    let shared_sqs_client = Arc::new(sqs_client);
    let shared_dynamodb_client = Arc::new(dynamodb_client);

    let func = service_fn(
        move |event: LambdaEvent<EventBridgeEvent<S3CreateObjectDetail>>| {
            let sqs_client = shared_sqs_client.clone();
            let dynamodb_client = shared_dynamodb_client.clone();
            async move { handler(dynamodb_client, sqs_client, event).await }
        },
    );

    run(func).await
}
