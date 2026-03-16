use anyhow::Context;
use models_properties::{EntityReference, EntityType};
use properties_db_client::entity_properties::delete as entity_properties_delete;

use super::DeleteDocumentWorkerContext;

#[tracing::instrument(skip(ctx, message), fields(message_id=message.message_id), err)]
pub async fn handle(
    ctx: &DeleteDocumentWorkerContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    tracing::debug!("processing delete document message");

    let (document_id, mut user_id) = if let Some(attributes) = message.message_attributes.as_ref() {
        let document_id = attributes
            .get("document_id")
            .map(|document_id| {
                tracing::trace!(document_id=?document_id, "found document_id in message attributes");
                document_id.string_value().unwrap_or_default()
            })
            .context("document_id should be a message attribute")?;

        let user_id = attributes.get("user_id").map(|user_id| {
            tracing::trace!(user_id=?user_id, "found user_id in message attributes");
            user_id.string_value().unwrap_or_default().to_string()
        });

        (document_id, user_id)
    } else {
        ctx.worker.cleanup_message(message).await?;
        anyhow::bail!("message attributes not found")
    };

    // Only need to get and delete document from macrodb if the user_id is not present in the message attributes
    if user_id.is_none() {
        tracing::info!(document_id=%document_id, "starting delete process for document");

        let document = macro_db_client::document::get_deleted_document_info(&ctx.db, document_id)
            .await
            .inspect_err(
                |e| tracing::error!(error=?e, document_id=%document_id, "unable to get document"),
            )?;

        let shared_document = document.clone();
        user_id = Some(shared_document.owner.to_string());

        tracing::trace!(document_id=%document_id, user_id=?user_id, file_type=?document.file_type, "retrieved document");

        if let Some(file_type) = document.file_type
            && file_type.as_str() == "docx"
        {
            // Get the sha counts to decrement from the documents bom parts
            let bom_parts =
                macro_db_client::document::get_bom_parts(&ctx.db, &document.document_id).await?;

            // Transform bom parts into Vec<(sha, count)>
            let sha_counts = count_occurrences(
                bom_parts
                    .iter()
                    .map(|bp| bp.sha.clone())
                    .collect::<Vec<String>>(),
            );

            tracing::trace!("decrementing sha ref count");
            ctx.redis_client.decrement_counts(&sha_counts).await?;
        }

        tracing::trace!(document_id=%document.document_id, "deleting document");
        macro_db_client::document::delete_document(&ctx.db, &document.document_id).await?;
        tracing::trace!(document_id=%document.document_id, "deleted document");
    }

    // delete entity mentions where this doc is the source
    let _ = comms_db_client::entity_mentions::delete_entity_mentions_by_source(
        &ctx.db,
        vec![document_id.to_string()],
    )
    .await
    .inspect_err(|e| {
        tracing::warn!(error=?e, "could not delete entity mentions for document");
    });

    let user_id = user_id.context("user_id should be some")?;

    // Delete files from s3
    tracing::trace!(user_id=%user_id, document_id=%document_id, "deleting files from s3");
    ctx.s3_client
        .delete_document(&user_id, document_id)
        .await
        .context("failed to delete files from s3")?;
    tracing::trace!(document_id=%document_id, "deleted files from s3");

    // Delete files from sync service
    let _ = ctx
        .sync_service_client
        .delete(document_id)
        .await
        .inspect_err(|e| {
            tracing::trace!(error=?e, "could not delete file from sync service");
        });

    // Delete document properties
    tracing::trace!(document_id=%document_id, "deleting document properties");

    let entity_reference = EntityReference::new(document_id, EntityType::Document);
    let _ = entity_properties_delete::delete_entity(&ctx.db, &entity_reference)
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to delete entity properties"));
    tracing::trace!(document_id=%document_id, "deleted document properties");

    let _ = ctx.worker.cleanup_message(message).await.inspect_err(|e| {
        tracing::error!(error=?e, "failed to cleanup message");
    });

    Ok(())
}

pub(crate) fn count_occurrences(strings: Vec<String>) -> Vec<(String, i64)> {
    use std::collections::HashMap;

    let mut counts = HashMap::new();

    for string in strings {
        *counts.entry(string).or_insert(0) += 1;
    }

    counts
        .into_iter()
        .map(|(string, count)| (string, count as i64))
        .collect()
}
