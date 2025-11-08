use aws_lambda_events::event::s3::S3Event;
#[allow(unused_imports)]
use futures::stream::TryStreamExt;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self, Level},
};

use crate::{context::Context, models::DocumentKeyParts, service};

/// Processes the s3 event
#[tracing::instrument(skip(ctx, event))]
pub async fn handler(ctx: Context, event: LambdaEvent<S3Event>) -> Result<(), Error> {
    tracing::info!(
        "processing s3 records record_count={}",
        event.payload.records.len()
    );

    for record in event.payload.records {
        let key = record
            .s3
            .object
            .key
            .clone()
            .unwrap_or_else(|| "".to_string());
        let bucket = record
            .s3
            .bucket
            .name
            .clone()
            .unwrap_or_else(|| "".to_string());
        let span = tracing::span!(Level::TRACE, "process_record", key = key);
        let _guard = span.enter();
        match service::document::process(ctx.clone(), &bucket, &key).await {
            Ok(_) => (),
            Err(err) => {
                tracing::error!(error=?err, "error processing record");
                // In the event of an error, we want to send a notification to the web socket
                // so the user can know the job is done processing
                let document_key_parts = match DocumentKeyParts::from_s3_key(&key) {
                    Ok(parts) => parts,
                    Err(e) => {
                        tracing::error!(error=?e, key=?key, bucket=?bucket, "invalid key format");
                        return Err(err.into());
                    }
                };

                let result = service::document::handle_docx_unzip_failure(
                    ctx.db.clone(),
                    ctx.lambda_client.clone(),
                    ctx.config.web_socket_response_lambda.as_str(),
                    document_key_parts.document_id.as_str(),
                )
                .await;

                if let Err(err) = result {
                    tracing::error!(error=?err, "error handling docx unzip notification");
                }
            }
        }
    }

    tracing::trace!("processing complete");

    Ok(())
}
