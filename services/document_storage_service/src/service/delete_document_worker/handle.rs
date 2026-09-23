use anyhow::Context;
use documents_hex::domain::ports::editing::EditingWorkerService;
use entity_access::domain::models::EntityType;
use model_owner::Owner;
use properties::{EditReceipt, PropertiesService as _};

use super::DeleteDocumentWorkerContext;

#[tracing::instrument(skip(ctx, message), fields(message_id=message.message_id), err)]
pub async fn handle(
    ctx: &DeleteDocumentWorkerContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    tracing::debug!("processing delete document message");

    let (document_id, mut owner) = if let Some(attributes) = message.message_attributes.as_ref() {
        document_and_owner(attributes)?
    } else {
        ctx.worker.cleanup_message(message).await?;
        anyhow::bail!("message attributes not found")
    };

    // Only need to get and delete document from macrodb if the owner is not present in the message attributes
    if owner.is_none() {
        tracing::info!(document_id=%document_id, "starting delete process for document");

        let document = macro_db_client::document::get_deleted_document_info(&ctx.db, document_id)
            .await
            .inspect_err(
                |e| tracing::error!(error=?e, document_id=%document_id, "unable to get document"),
            )?;

        owner = Some(document.owner.clone());

        tracing::trace!(document_id=%document_id, owner=?owner, file_type=?document.file_type, "retrieved document");

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

    let owner = owner.context("owner should be some")?;

    // Delete files from s3
    tracing::trace!(owner=%owner, document_id=%document_id, "deleting files from s3");
    ctx.s3_client
        .delete_document(&owner, document_id)
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

    // Delete AI edit traces (they hold full document content)
    let _ = ctx
        .editing_worker_client
        .delete_traces(document_id)
        .await
        .inspect_err(|e| {
            tracing::trace!(error=?e, "could not delete ai edit traces");
        });

    // Delete document properties
    tracing::trace!(document_id=%document_id, "deleting document properties");

    let cleanup_receipt = document_cleanup_receipt(document_id);
    let _ = ctx
        .properties_service
        .delete_entity_properties(&cleanup_receipt)
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to delete entity properties"));
    tracing::trace!(document_id=%document_id, "deleted document properties");

    let _ = ctx.worker.cleanup_message(message).await.inspect_err(|e| {
        tracing::error!(error=?e, "failed to cleanup message");
    });

    Ok(())
}

pub(super) fn document_and_owner(
    attributes: &std::collections::HashMap<String, aws_sdk_sqs::types::MessageAttributeValue>,
) -> anyhow::Result<(&str, Option<Owner>)> {
    let document_id = attributes
        .get("document_id")
        .map(|document_id| document_id.string_value().unwrap_or_default())
        .context("document_id should be a message attribute")?;

    // The `user_id` attribute carries the owner principal (`macro|<email>`,
    // `bot|<uuid>`, or a team UUID); it keeps its historical name on the wire.
    let owner = attributes
        .get("user_id")
        .map(|owner| Owner::from_principal_str(owner.string_value().unwrap_or_default()))
        .transpose()
        .context("user_id message attribute should be an owner principal")?;

    Ok((document_id, owner))
}

pub(crate) fn document_cleanup_receipt(document_id: &str) -> EditReceipt {
    EditReceipt::dangerously_assert_internal_user(document_id, EntityType::Document)
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
