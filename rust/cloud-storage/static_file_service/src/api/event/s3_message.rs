use super::message::{S3EventKind::*, *};
use super::s3_create;
use crate::service::dynamodb::client::DynamodbClient;
use aws_sdk_sqs::types::Message;
use serde_json::from_str;

#[tracing::instrument(skip(metadata_client))]
pub async fn handle_s3_message(message: Message, metadata_client: DynamodbClient) -> Option<()> {
    tracing::debug!("processing sqs message {:?}", message);
    if let Some(text) = message.body {
        let body: S3EventNotification = from_str(text.as_str())
            .map_err(|err| {
                tracing::error!(error=?err, "failed to deserialize sqs message");
                err
            })
            .ok()?;
        handle_s3_events(body, metadata_client.clone()).await;
        None
    } else {
        tracing::warn!("what the freak (no message body)");
        None
    }
}

#[tracing::instrument(skip(metadata_client))]
async fn handle_s3_events(event: S3EventNotification, metadata_client: DynamodbClient) {
    for event in event.records {
        match event.event_kind {
            ObjectCreatedAll
            | ObjectCreatedCompleteMultipartUpload
            | ObjectCreatedPut
            | ObjectCreatedCopy
            | ObjectCreatedPost => {
                let _ = s3_create::handle_s3_create(event, metadata_client.clone())
                    .await
                    .map_err(
                        |err| tracing::error!(error=?err, "failed to handle S3::CreateObject:*"),
                    );
            }
            _ => {}
        }
    }
}
