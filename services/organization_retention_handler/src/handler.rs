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
#[tracing::instrument(skip(db, sqs_client, event))]
pub async fn handler(
    db: Arc<service::db::DB>,
    sqs_client: Arc<sqs_client::SQS>,
    event: LambdaEvent<SqsEvent>,
) -> Result<(), Error> {
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

    let organization_id: i32 = match record.message_attributes.get("organization_id") {
        Some(organization_id) => organization_id
            .string_value
            .clone()
            .context("expected organization_id to be a string")?
            .parse::<i32>()
            .context("expected organization_id to be an integer")?,
        None => {
            tracing::error!("organization_id not found in message attributes");
            return Err(Error::from(
                "organization_id not found in message attributes",
            ));
        }
    };

    let retention_days: i32 = match record.message_attributes.get("retention_days") {
        Some(retention_days) => retention_days
            .string_value
            .clone()
            .context("expected retention_days to be a string")?
            .parse::<i32>()
            .context("expected retention_days to be an integer")?,
        None => {
            tracing::error!("retention_days not found in message attributes");
            return Err(Error::from(
                "retention_days not found in message attributes",
            ));
        }
    };

    tracing::info!(organization_id=%organization_id, retention_days=%retention_days, "starting process for organization");

    let items = db
        .get_violating_items(organization_id, retention_days)
        .await?;

    if items.is_empty() {
        tracing::info!(organization_id=%organization_id, retention_days=%retention_days, "no items to process");
        return Ok(());
    }

    let documents: Vec<String> = items
        .iter()
        .filter_map(|item| match item.1.as_ref() {
            "document" => Some(item.0.clone()),
            _ => None,
        })
        .collect();

    let chats: Vec<String> = items
        .iter()
        .filter_map(|item| match item.1.as_ref() {
            "chat" => Some(item.0.clone()),
            _ => None,
        })
        .collect();

    tracing::trace!(
        organization_id=%organization_id,
        retention_days=%retention_days,
        documents=%documents.len(),
        chats=%chats.len(),
        "ready to enqueue items for deletion"
    );

    sqs_client.bulk_enqueue_document_delete(documents).await?;

    sqs_client.bulk_enqueue_chat_delete(chats).await?;

    Ok(())
}
