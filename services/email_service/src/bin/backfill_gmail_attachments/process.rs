use crate::upload::AttachmentProcessor;
use crate::{auth, config, database, upload};
use anyhow::Context;
use email_api_client::GmailApiClientRepository;
use email_api_client::domain::ports::AlwaysAllowRateLimiter;
use email_api_client::domain::service::EmailApiClientServiceImpl;
use email_service::outbound::email_api::StaticTokenSource;
use futures::{StreamExt, stream};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Process attachments for a single macro ID
pub async fn process_macro_id(
    config: &config::Config,
    db_pool: &sqlx::PgPool,
    dss_client: &document_storage_service_client::DocumentStorageServiceClient,
    email_api_repository: &GmailApiClientRepository,
    macro_id: &str,
) -> anyhow::Result<(usize, usize)> {
    // Get fresh Gmail access token for this macro ID
    let gmail_access_token = auth::get_gmail_access_token(config, macro_id).await?;
    println!("Successfully obtained Gmail access token for {}", macro_id);

    // Fetch the link associated with the user's account.
    let link = email_db_client::links::get::fetch_link_by_macro_id(db_pool, macro_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("No link found for macro ID: {}", macro_id))?;

    // Fetch all relevant attachment metadata from the database.
    println!(
        "Fetching unique attachment metadata from database for {}...",
        macro_id
    );
    let attachments = database::fetch_unique_attachments(db_pool, link.id)
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

    // Process and upload each attachment.
    let email_api = EmailApiClientServiceImpl::new(
        email_api_repository.clone(),
        StaticTokenSource::new(gmail_access_token),
        AlwaysAllowRateLimiter,
    );
    let processor = Arc::new(upload::AttachmentProcessor::new(
        db_pool.clone(),
        dss_client.clone(),
        email_api,
        macro_id.to_string(),
    ));

    let success_count = Arc::new(AtomicUsize::new(0));
    let total_attachments = attachments.len();

    println!("Starting concurrent upload process for {}...", macro_id);

    stream::iter(attachments.into_iter().enumerate())
        .for_each_concurrent(config.upload_concurrency, |(index, attachment)| {
            let processor: Arc<AttachmentProcessor> = Arc::clone(&processor);
            let success_count = Arc::clone(&success_count);
            let macro_id = macro_id.to_string();
            let link = link.clone();

            async move {
                match processor.upload(&link, &attachment).await {
                    Ok(_) => {
                        success_count.fetch_add(1, Ordering::Relaxed);
                        println!("Successfully uploaded '{}' (index: {}) for {}", attachment.filename.unwrap_or("N/A".to_string()), index, macro_id);
                    }
                    Err(e) => {
                        // ignore weird file types. annoying game of whack a mole
                        if e.to_string().contains("file extension") {
                            println!(
                                "Skipping '{}' (index: {}) for {} due to unsupported mime type {}",
                                attachment.filename.unwrap_or("N/A".to_string()), index, macro_id, attachment.mime_type
                            );
                            return;
                        }
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
        })
        .await;

    let final_success_count = success_count.load(Ordering::SeqCst);
    Ok((final_success_count, total_attachments))
}
