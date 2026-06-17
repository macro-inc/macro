use crate::pubsub::sfs_uploader::context::SFSUploaderContext;
use crate::pubsub::util::cg_refresh_email;
use crate::util::process_pre_insert::sfs_map::fetch_and_upload_to_sfs;
use anyhow::{Context, anyhow};
use aws_sdk_sqs::types::Message;
use models_email::api::refresh::RefreshEmailEvent;
use models_email::service::pubsub::SFSUploaderMessage;
use sqs_worker::cleanup_message;
use std::collections::HashMap;
use uuid::Uuid;

// upload user photo_url to SFS and add url to database
pub async fn process_message(ctx: SFSUploaderContext, message: &Message) -> anyhow::Result<()> {
    let sfs_message = extract_sfs_upload_notification(message)?;

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

    let link_id = contact.link_id;
    let contact_email = contact.email_address.clone();

    match email_db_client::contacts::upsert_sync::upsert_contacts(&ctx.db, &[contact]).await {
        Ok(_) => notify_if_self_contact(&ctx, link_id, contact_email.as_deref()).await,
        Err(err) => tracing::error!(error = ?err, "Unable to upsert contact"),
    }

    cleanup_message(&ctx.sqs_worker, message).await?;

    Ok(())
}

/// Emit `PhotoSynced` only when the uploaded contact is the inbox's own
/// self-contact, i.e. its email matches the link's inbox address. The worker
/// also uploads correspondent and attachment images, which share no email with
/// the inbox and must not signal that the inbox's own photo changed.
async fn notify_if_self_contact(
    ctx: &SFSUploaderContext,
    link_id: Uuid,
    contact_email: Option<&str>,
) {
    let Some(contact_email) = contact_email else {
        return;
    };

    let link = match email_db_client::links::get::fetch_link_by_id(&ctx.db, link_id).await {
        Ok(Some(link)) => link,
        Ok(None) => return,
        Err(e) => {
            tracing::error!(error = ?e, link_id = %link_id, "Failed to fetch link for photo sync");
            return;
        }
    };

    if !contact_email.eq_ignore_ascii_case(link.email_address.0.as_ref()) {
        return;
    }

    cg_refresh_email(
        &ctx.connection_gateway_client,
        link.macro_id.as_ref(),
        RefreshEmailEvent::PhotoSynced { link_id },
    )
    .await;
}

/// Deserializes the SQS message body into a SfsUploaderMessage struct.
#[tracing::instrument(skip(message))]
fn extract_sfs_upload_notification(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<SFSUploaderMessage> {
    tracing::debug!("Extracting sfs upload notification from message");
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
