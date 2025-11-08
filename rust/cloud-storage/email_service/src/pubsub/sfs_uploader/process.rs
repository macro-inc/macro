use crate::pubsub::sfs_uploader::context::SFSUploaderContext;
use crate::util::process_pre_insert::sfs_map::fetch_and_upload_to_sfs;
use anyhow::{Context, anyhow};
use aws_sdk_sqs::types::Message;
use models_email::service::pubsub::SFSUploaderMessage;
use sqs_worker::cleanup_message;
use std::collections::HashMap;

// upload user photo_url to SFS and add url to database
pub async fn process_message(ctx: SFSUploaderContext, message: &Message) -> anyhow::Result<()> {
    let sfs_message = extract_refresh_notification(message)?;

    let mut contact = sfs_message.contact;
    let original_photo_url = contact
        .original_photo_url
        .as_ref()
        .context("Contact has no photo URL")?;

    // only fetch and upload to sfs if a mapping doesn't already exist for the url (probably won't)
    let sfs_url = match email_db_client::sfs_mappings::fetch_sfs_mapping(
        &ctx.db,
        original_photo_url,
    )
    .await
    {
        Ok(Some(existing_url)) => existing_url,
        Ok(None) => upload_and_store_mapping(&ctx, original_photo_url).await?,
        Err(e) => {
            tracing::error!(error = ?e, "Unable to fetch SFS mapping from database, falling back to upload");
            upload_and_store_mapping(&ctx, original_photo_url).await?
        }
    };

    // update contact's photo url to new SFS url and upsert entry in database
    contact.sfs_photo_url = Some(sfs_url);

    if let Err(err) =
        email_db_client::contacts::upsert_sync::upsert_contacts(&ctx.db, &[contact]).await
    {
        tracing::error!(error = ?err, "Unable to upsert contact");
    }

    cleanup_message(&ctx.sqs_worker, message).await?;

    Ok(())
}

/// Deserializes the SQS message body into a RefreshMessage struct.
#[tracing::instrument(skip(message))]
fn extract_refresh_notification(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<SFSUploaderMessage> {
    tracing::debug!("Extracting refresh notification from message");
    let message_body = message.body().context("message body not found")?;

    serde_json::from_str(message_body)
        .context("Failed to deserialize message body to SFSUploaderMessage")
}

async fn upload_and_store_mapping(
    ctx: &SFSUploaderContext,
    photo_url: &str,
) -> anyhow::Result<String> {
    tracing::debug!(url = ?photo_url, "Uploading photo to SFS");
    let (old_url, new_sfs_url) = fetch_and_upload_to_sfs(ctx.sfs_client.clone(), photo_url)
        .await
        .map_err(|e| {
            tracing::error!(error = ?e, "Unable to fetch and upload file to SFS");
            anyhow!("Unable to fetch and upload file to SFS")
        })?
        .ok_or_else(|| {
            tracing::warn!("URL not uploaded to SFS");
            anyhow!("URL not uploaded to SFS")
        })?;

    tracing::debug!(old_url = ?old_url, new_url = ?new_sfs_url, "Successfully uploaded to SFS");

    // Insert the new mapping into database (best effort)
    if let Err(err) = email_db_client::sfs_mappings::insert_sfs_mappings(
        &ctx.db,
        &HashMap::from([(old_url, new_sfs_url.clone())]),
    )
    .await
    {
        tracing::error!(error = ?err, "Unable to insert mapping into sfs_mappings");
    } else {
        tracing::debug!("Successfully inserted SFS mapping");
    }

    Ok(new_sfs_url)
}
