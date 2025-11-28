use crate::{config, database};
use anyhow::Context;
use futures::{StreamExt, stream};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Process documents for a single macro ID
pub async fn process_macro_id(
    config: &config::Config,
    db_pool: &sqlx::PgPool,
    dss_client: &document_storage_service_client::DocumentStorageServiceClient,
    macro_id: &str,
) -> anyhow::Result<(usize, usize)> {
    let document_ids = database::fetch_document_ids(db_pool, macro_id)
        .await
        .context("Failed to fetch document ids")?;
    println!(
        "Found {} document ids to process for {}.",
        document_ids.len(),
        macro_id
    );

    if document_ids.is_empty() {
        return Ok((0, 0));
    }

    let success_count = Arc::new(AtomicUsize::new(0));
    let total_documents = document_ids.len();

    println!("Starting concurrent upload process for {}...", macro_id);

    stream::iter(document_ids.into_iter().enumerate())
        .for_each_concurrent(config.delete_concurrency, |(index, document_id)| {
            let dss_client_clone = dss_client.clone();
            let success_count = Arc::clone(&success_count);
            let macro_id = macro_id.to_string();

            async move {
                match dss_client_clone
                    .delete_document_permanent_internal(&document_id, &macro_id)
                    .await
                {
                    Ok(_) => {
                        success_count.fetch_add(1, Ordering::Relaxed);
                        println!(
                            "Successfully deleted '{}' (index: {}) for {}",
                            document_id, index, macro_id
                        );
                    }
                    Err(e) => {
                        panic!(
                            "Failed to delete document - id: {}, error: {:?}",
                            document_id, e
                        );
                    }
                }
            }
        })
        .await;

    let final_success_count = success_count.load(Ordering::SeqCst);
    Ok((final_success_count, total_documents))
}
