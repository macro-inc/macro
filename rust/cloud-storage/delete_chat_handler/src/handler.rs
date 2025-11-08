use std::sync::Arc;

use anyhow::Context;
use aws_lambda_events::event::sqs::SqsEvent;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};

use crate::service;

/// Handles the SQS event
/// We have set it up to only process 1 record per lambda to avoid any potential timeouts
#[tracing::instrument(skip(db, event))]
pub async fn handler(db: Arc<service::db::DB>, event: LambdaEvent<SqsEvent>) -> Result<(), Error> {
    if event.payload.records.len() != 1 {
        tracing::error!(
            "Expected 1 message, got {}. The queue has been misconfigured.",
            event.payload.records.len()
        );
        return Err(Error::from(
            "Expected 1 message, got 0. The queue has been misconfigured.",
        ));
    }

    let record = event.payload.records.first().unwrap();

    tracing::trace!(record=?record, "processing record");

    let chat_id: String = match record.message_attributes.get("chat_id") {
        Some(chat_id) => chat_id
            .string_value
            .clone()
            .context("expected chat id to be a string")
            .unwrap(),
        None => {
            tracing::error!("chat_id not found in message attributes");
            return Err(Error::from("chat_id not found in message attributes"));
        }
    };

    let is_deleted = db.is_chat_deleted(chat_id.as_str()).await?;

    if !is_deleted {
        tracing::info!(chat_id=%chat_id, "chat is not deleted, skipping");
        return Ok(());
    }

    db.delete_chat(chat_id.as_str()).await?;

    Ok(())
}
