//! Processing logic for finding unused SFS UUIDs.

use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;

use anyhow::Context;
use futures::TryStreamExt;
use sqlx::PgPool;

/// Length of a UUID string (8-4-4-4-12 format with dashes).
const UUID_LENGTH: usize = 36;

/// Streams mapping destinations from the database, extracts UUIDs, and writes them to a file.
/// Returns the number of UUIDs written.
pub async fn stream_mapping_uuids_to_file(db: &PgPool, file_path: &Path) -> anyhow::Result<usize> {
    let file = File::create(file_path)
        .with_context(|| format!("Failed to create file: {}", file_path.display()))?;
    let mut writer = BufWriter::new(file);

    let mut stream =
        sqlx::query_scalar::<_, String>("SELECT destination FROM public.email_sfs_mappings")
            .fetch(db);

    let mut count = 0;
    while let Some(destination) = stream.try_next().await? {
        let uuid = extract_uuid_from_url(&destination);
        writeln!(writer, "{}", uuid).context("Failed to write UUID to file")?;
        count += 1;

        // Flush periodically to avoid buffering too much in memory
        if count % 10000 == 0 {
            writer.flush().context("Failed to flush buffer")?;
            println!("  Streamed {} UUIDs so far...", count);
        }
    }

    writer.flush().context("Failed to flush final buffer")?;
    Ok(count)
}

/// Extracts a UUID string from the end of a URL.
/// Assumes the last 36 characters are always the UUID.
/// Expected format: https://domain.com/file/{uuid}
pub fn extract_uuid_from_url(url: &str) -> String {
    if url.len() >= UUID_LENGTH {
        url[url.len() - UUID_LENGTH..].to_string()
    } else {
        url.to_string()
    }
}

/// Loads UUID strings from a file into a HashSet for O(1) lookups.
pub fn load_uuids_from_file(path: &Path) -> anyhow::Result<HashSet<String>> {
    if !path.exists() {
        anyhow::bail!("File does not exist: {}", path.display());
    }

    let file = File::open(path).context("Failed to open UUIDs file")?;
    let reader = BufReader::new(file);
    let mut uuids = HashSet::new();

    for line in reader.lines() {
        let line = line.context("Failed to read line")?;
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            uuids.insert(trimmed.to_string());
        }
    }

    Ok(uuids)
}

/// Counts non-empty lines in a file without loading all into memory.
pub fn count_lines_in_file(path: &Path) -> anyhow::Result<usize> {
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

/// Streams through all mapping UUIDs and writes unused ones to a file.
/// Returns the count of unused UUIDs found.
pub fn stream_find_unused_uuids(
    all_mappings_file: &Path,
    used_uuids: &HashSet<String>,
    output_file: &Path,
) -> anyhow::Result<usize> {
    if !all_mappings_file.exists() {
        anyhow::bail!(
            "All mappings file does not exist: {}",
            all_mappings_file.display()
        );
    }

    let input = File::open(all_mappings_file)
        .with_context(|| format!("Failed to open file: {}", all_mappings_file.display()))?;
    let reader = BufReader::new(input);

    let output = File::create(output_file)
        .with_context(|| format!("Failed to create file: {}", output_file.display()))?;
    let mut writer = BufWriter::new(output);

    let mut count = 0;
    let mut processed = 0;

    for line in reader.lines() {
        let line = line.context("Failed to read line")?;
        let uuid = line.trim();

        if !uuid.is_empty() {
            processed += 1;

            // If this UUID is not in the used set, it's unused
            if !used_uuids.contains(uuid) {
                writeln!(writer, "{}", uuid).context("Failed to write unused UUID")?;
                count += 1;
            }

            // Progress update every 100k UUIDs
            if processed % 100000 == 0 {
                writer.flush().context("Failed to flush buffer")?;
                println!(
                    "  Processed {} UUIDs, found {} unused so far...",
                    processed, count
                );
            }
        }
    }

    writer.flush().context("Failed to flush final buffer")?;
    Ok(count)
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_extract_uuid_from_url_basic() {
        let url =
            "https://static-file-service-dev.macro.com/file/bc698c53-5a61-45f9-ac88-212e22cf8a33";
        let uuid = extract_uuid_from_url(url);
        assert_eq!(uuid, "bc698c53-5a61-45f9-ac88-212e22cf8a33");
    }

    #[test]
    fn test_extract_uuid_from_url_different_domain() {
        let url = "https://other-domain.com/assets/bc698c53-5a61-45f9-ac88-212e22cf8a33";
        let uuid = extract_uuid_from_url(url);
        assert_eq!(uuid, "bc698c53-5a61-45f9-ac88-212e22cf8a33");
    }

    #[test]
    fn test_extract_uuid_from_url_short_url() {
        let url = "short";
        let uuid = extract_uuid_from_url(url);
        assert_eq!(uuid, "short");
    }
}
