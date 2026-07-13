//! Processing logic for cleaning up unused SFS files.

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use anyhow::Context;
use futures::stream::{self, Stream};
use sqlx::PgPool;
use tokio::sync::mpsc;

/// Counts non-empty lines in a file without loading all into memory.
pub fn count_uuids_in_file(path: &Path) -> anyhow::Result<usize> {
    if !path.exists() {
        anyhow::bail!("File does not exist: {}", path.display());
    }

    let file =
        File::open(path).with_context(|| format!("Failed to open file: {}", path.display()))?;
    let reader = BufReader::new(file);

    let mut count = 0;
    for line in reader.lines() {
        let line = line.context("Failed to read line")?;
        if !line.trim().is_empty() {
            count += 1;
        }
    }

    Ok(count)
}

/// Creates an async stream of UUIDs from a file.
/// Returns a stream that yields UUIDs one at a time.
pub fn stream_uuids_from_file(
    path: &Path,
) -> anyhow::Result<impl Stream<Item = Result<String, anyhow::Error>>> {
    if !path.exists() {
        anyhow::bail!("File does not exist: {}", path.display());
    }

    let file =
        File::open(path).with_context(|| format!("Failed to open file: {}", path.display()))?;

    let (tx, rx) = mpsc::channel(1000);

    // Spawn a task to read the file and send UUIDs through the channel
    tokio::spawn(async move {
        let reader = BufReader::new(file);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() && tx.send(Ok(trimmed.to_string())).await.is_err() {
                        // Receiver dropped, stop reading
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx.send(Err(anyhow::Error::from(e))).await;
                    break;
                }
            }
        }
    });

    // Convert the receiver to a stream using futures::stream::unfold
    Ok(stream::unfold(rx, |mut rx| async move {
        rx.recv().await.map(|item| (item, rx))
    }))
}

/// Result of an SFS delete operation.
pub enum SfsDeleteResult {
    /// File was successfully deleted.
    Deleted,
    /// File was already deleted (404).
    AlreadyDeleted,
    /// An error occurred.
    Error(anyhow::Error),
}

/// Deletes a file from SFS.
pub async fn delete_from_sfs(
    sfs_client: &static_file_service_client::StaticFileServiceClient,
    uuid: &str,
) -> SfsDeleteResult {
    match sfs_client.delete_file(uuid).await {
        Ok(_status) => SfsDeleteResult::Deleted,
        Err(e) => {
            // Check if it's a 404 - the file is already gone
            let err_str = format!("{:?}", e);
            if err_str.contains("404") {
                SfsDeleteResult::AlreadyDeleted
            } else {
                SfsDeleteResult::Error(e)
            }
        }
    }
}

/// Deletes the mapping row from email_sfs_mappings by destination URL.
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub async fn delete_mapping_from_db(db: &PgPool, destination_url: &str) -> anyhow::Result<bool> {
    let result = sqlx::query("DELETE FROM public.email_sfs_mappings WHERE destination = $1")
        .bind(destination_url)
        .execute(db)
        .await
        .context("Failed to delete mapping from database")?;

    Ok(result.rows_affected() > 0)
}

/// Deletes multiple mapping rows from email_sfs_mappings by destination URLs.
/// Returns the number of rows deleted.
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub async fn bulk_delete_mappings_from_db(
    db: &PgPool,
    destination_urls: &[String],
) -> anyhow::Result<u64> {
    if destination_urls.is_empty() {
        return Ok(0);
    }

    let result = sqlx::query("DELETE FROM public.email_sfs_mappings WHERE destination = ANY($1)")
        .bind(destination_urls)
        .execute(db)
        .await
        .context("Failed to bulk delete mappings from database")?;

    Ok(result.rows_affected())
}
