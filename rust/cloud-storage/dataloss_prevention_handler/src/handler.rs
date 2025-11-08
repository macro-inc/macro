use anyhow::Context;
use aws_lambda_events::s3::S3Event;
use lambda_runtime::{Error, LambdaEvent, tracing};

const USER_AGENT: &str = "arn:aws:iam::569036502058:user";

#[tracing::instrument(skip(s3_client, sns_client, topic_arn, event))]
pub async fn handler(
    s3_client: &s3_client::S3,
    sns_client: &sns_client::SNS,
    topic_arn: &str,
    event: LambdaEvent<S3Event>,
) -> Result<(), Error> {
    for record in event.payload.records {
        let bucket: &str = record.s3.bucket.name.as_ref().context("expected bucket")?;
        let key: &str = record.s3.object.key.as_ref().context("expected key")?;

        let bytes = s3_client.get(bucket, key).await.map_err(|e| {
            tracing::error!(error=?e, "could not retrieve file from s3");
            Error::from("could not retrieve file from s3")
        })?;
        tracing::trace!(bucket, key, "retreived file");

        let content = String::from_utf8(bytes)?;

        if content.contains(USER_AGENT) {
            tracing::trace!(bucket, key, "file contains user agent");
            sns_client
                .publish(
                    topic_arn,
                    &format!("unauthorized document storage access detected: {content}"),
                )
                .await?;
        } else {
            // Delete item from S3
            tracing::trace!(bucket, key, "file clean");
            // We don't actually care if it fails to delete
            match s3_client.delete(bucket, key).await {
                Ok(_) => {}
                Err(e) => {
                    tracing::error!(error=?e, bucket, key, "could not delete file from s3");
                }
            }
        }
    }

    Ok(())
}
