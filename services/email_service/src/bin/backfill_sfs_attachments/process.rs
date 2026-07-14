use crate::upload::AttachmentProcessor;
use crate::{auth, config, database, upload};
use anyhow::Context;
use futures::{StreamExt, stream};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Process attachments for a single macro ID
pub async fn process_macro_id(
    config: &config::Config,
    db_pool: &sqlx::PgPool,
    sfs_client: &static_file_service_client::StaticFileServiceClient,
    gmail_client: &gmail_client::GmailClient,
    macro_id: &str,
) -> anyhow::Result<(usize, usize)> {
    // Fetch all relevant attachment metadata from the database.
    println!(
        "Fetching unique attachment metadata from database for {}...",
        macro_id
    );
    let attachments = database::fetch_sfs_attachments(db_pool, macro_id)
        .await
        .context("Failed to fetch attachment metadata")?;
    println!(
        "Found {} unique attachments to process for {}.",
        attachments.len(),
        macro_id
    );

    if attachments.is_empty() {
        return Ok((0, 0));
    }

    // Get fresh Gmail access token for this macro ID
    let gmail_access_token = auth::get_gmail_access_token(config, macro_id).await?;
    println!("Successfully obtained Gmail access token for {}", macro_id);

    // Process and upload each attachment.
    let processor = Arc::new(upload::AttachmentProcessor::new(
        db_pool.clone(),
        sfs_client.clone(),
        gmail_client.clone(),
        gmail_access_token,
    ));

    let success_count = Arc::new(AtomicUsize::new(0));
    let total_attachments = attachments.len();

    println!("Starting concurrent upload process for {}...", macro_id);

    stream::iter(attachments.into_iter().enumerate())
        .for_each_concurrent(config.upload_concurrency, |(index, attachment)| {
            let processor: Arc<AttachmentProcessor> = Arc::clone(&processor);
            let success_count = Arc::clone(&success_count);
            let macro_id = macro_id.to_string();

            async move {
                match processor.upload(&attachment).await {
                    Ok(_) => {
                        success_count.fetch_add(1, Ordering::Relaxed);
                        println!("Successfully uploaded '{}' (index: {}) for {}", attachment.filename.unwrap_or("N/A".to_string()), index, macro_id);
                    }
                    Err(e) => {
                        let err_str = format!("{e:?}");

                        if err_str.contains("404") {
                            println!(
                                "Attachment upload got 404; skipping and continuing. filename: {}, provider_attachment_id: {}, provider_message_id: {}, index: {}, macro_id: {}, error: {:?}",
                                attachment.filename.clone().unwrap_or("N/A".to_string()),
                                attachment.provider_attachment_id,
                                attachment.email_provider_id,
                                index,
                                macro_id,
                                e
                            );
                        } else if err_str.contains("500") {
                            println!(
                                "Attachment upload got 500; skipping and continuing. filename: {}, provider_attachment_id: {}, provider_message_id: {}, index: {}, macro_id: {}, error: {:?}",
                                attachment.filename.clone().unwrap_or("N/A".to_string()),
                                attachment.provider_attachment_id,
                                attachment.email_provider_id,
                                index,
                                macro_id,
                                e
                            );
                        } else if err_str.contains("400") {
                            println!(
                                "Attachment upload got 400; skipping and continuing. filename: {}, provider_attachment_id: {}, provider_message_id: {}, index: {}, macro_id: {}, error: {:?}",
                                attachment.filename.clone().unwrap_or("N/A".to_string()),
                                attachment.provider_attachment_id,
                                attachment.email_provider_id,
                                index,
                                macro_id,
                                e
                            );
                        } else {
                            panic!(
                                "Failed to upload attachment - filename: {}, provider_attachment_id: {}, provider_message_id: {}, index: {}, macro_id: {}, error: {:?}",
                                attachment.filename.unwrap_or("N/A".to_string()),
                                attachment.provider_attachment_id,
                                attachment.email_provider_id,
                                index,
                                macro_id,
                                e
                            );
                        }
                    }
                }
            }
        })
        .await;

    let final_success_count = success_count.load(Ordering::SeqCst);
    Ok((final_success_count, total_attachments))
}
