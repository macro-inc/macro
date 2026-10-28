pub mod extract_text_citations;
use anyhow::Context;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};
use std::{rc::Rc, sync::Arc};

use crate::{
    model::IncomingEvent,
    service::{self},
};

// Processes the sqs event
/// The way we've configured the lambda to run is that it will only process one message at a time
#[tracing::instrument(skip_all)]
pub async fn handler(
    db: Arc<service::db::DB>,
    s3_client: Arc<service::s3::S3>,
    pdfium: Rc<pdfium_render::prelude::Pdfium>,
    event: LambdaEvent<IncomingEvent>,
) -> Result<(), Error> {
    tracing::trace!(event=?event, "handler invoked");
    match event.payload {
        IncomingEvent::EventBridgeEvent(event) => {
            tracing::trace!(payload=?event, "processing record from eventbridge event");
            let event_detail = &event.detail;
            let bucket = event_detail
                .get("bucket")
                .and_then(|bucket| bucket.get("name"))
                .and_then(|name| name.as_str())
                .unwrap_or("")
                .to_string();

            let key = event_detail
                .get("object")
                .and_then(|object| object.get("key"))
                .and_then(|key| key.as_str())
                .unwrap_or("")
                .to_string();

            extract_text_citations::extract_text_from_document(
                &key,
                &bucket,
                pdfium.clone(),
                s3_client.clone(),
                db.clone(),
            )
            .await
            .map_err(|e| {
                tracing::error!(error=?e, key=?key, "unable to extract text from document");
                e
            })?;
        }
        IncomingEvent::SqsEvent(sqs_event) => {
            println!("EVENTBRIDGE");
            tracing::trace!(payload=?sqs_event, "processing record from sqs event");
            for record in sqs_event.records.iter() {
                let key = record
                    .message_attributes
                    .get("key")
                    .context("missing key in sqs event")?
                    .string_value
                    .clone()
                    .context("key is not a string in sqs event")?;

                let bucket = record
                    .message_attributes
                    .get("bucket")
                    .context("missing bucket in sqs event")?
                    .string_value
                    .clone()
                    .context("bucket is not a string in sqs event")?;

                extract_text_citations::extract_text_from_document(
                    &key,
                    &bucket,
                    pdfium.clone(),
                    s3_client.clone(),
                    db.clone(),
                )
                .await
                .map_err(|e| {
                    tracing::error!(error=?e, "unable to extract text from document");
                    e
                })?;
            }
        }
    }

    Ok(())
}
