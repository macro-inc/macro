//! Processing logic for finding used SFS UUIDs in email messages.

use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;

use anyhow::Context;
use regex::Regex;
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::Config;

/// Fetches all message IDs from the database.
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub async fn fetch_all_message_ids(db: &PgPool) -> anyhow::Result<Vec<Uuid>> {
    let rows: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM public.email_messages")
        .fetch_all(db)
        .await
        .context("Failed to fetch message IDs")?;

    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Loads message IDs from a file, or fetches from DB and saves to file if it doesn't exist.
pub async fn load_or_fetch_message_ids(db: &PgPool, config: &Config) -> anyhow::Result<Vec<Uuid>> {
    let path = Path::new(&config.message_ids_file);

    if path.exists() {
        println!(
            "Message IDs file exists at {}, loading from file...",
            config.message_ids_file
        );
        load_message_ids_from_file(path)
    } else {
        println!(
            "Message IDs file not found, fetching from database and saving to {}...",
            config.message_ids_file
        );
        let ids = fetch_all_message_ids(db).await?;
        save_message_ids_to_file(&ids, path)?;
        Ok(ids)
    }
}

/// Loads message IDs from a file.
fn load_message_ids_from_file(path: &Path) -> anyhow::Result<Vec<Uuid>> {
    let file = File::open(path).context("Failed to open message IDs file")?;
    let reader = BufReader::new(file);
    let mut ids = Vec::new();

    for line in reader.lines() {
        let line = line.context("Failed to read line from message IDs file")?;
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            let id = Uuid::parse_str(trimmed)
                .with_context(|| format!("Failed to parse UUID: {}", trimmed))?;
            ids.push(id);
        }
    }

    Ok(ids)
}

/// Saves message IDs to a file.
fn save_message_ids_to_file(ids: &[Uuid], path: &Path) -> anyhow::Result<()> {
    let file = File::create(path).context("Failed to create message IDs file")?;
    let mut writer = BufWriter::new(file);

    for id in ids {
        writeln!(writer, "{}", id).context("Failed to write message ID")?;
    }

    writer.flush().context("Failed to flush message IDs file")?;
    Ok(())
}

/// Message body result containing the message ID and its HTML body.
pub struct MessageBody {
    /// The message ID.
    pub id: Uuid,
    /// The sanitized HTML body, if present.
    pub body_html_sanitized: Option<String>,
}

/// Fetches message bodies in batch for the given message IDs.
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub async fn fetch_message_bodies_batch(
    db: &PgPool,
    message_ids: &[Uuid],
) -> anyhow::Result<Vec<MessageBody>> {
    if message_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Build a query with ANY($1) to fetch multiple messages at once
    let rows: Vec<(Uuid, Option<String>)> = sqlx::query_as(
        "SELECT id, body_html_sanitized FROM public.email_messages WHERE id = ANY($1)",
    )
    .bind(message_ids)
    .fetch_all(db)
    .await
    .context("Failed to fetch message bodies")?;

    Ok(rows
        .into_iter()
        .map(|(id, body_html_sanitized)| MessageBody {
            id,
            body_html_sanitized,
        })
        .collect())
}

/// Extracts SFS UUIDs from HTML content by finding URLs matching the configured domain.
pub fn extract_sfs_uuids(html: &str, sfs_domain: &str) -> HashSet<Uuid> {
    let mut uuids = HashSet::new();

    // Build regex pattern to match URLs like https://{domain}/file/{uuid}
    // The UUID is a standard format: 8-4-4-4-12 hex characters
    let pattern = format!(
        r#"https?://{}[^\s"'<>]*?/([0-9a-fA-F]{{8}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{12}})"#,
        regex::escape(sfs_domain)
    );

    let re = match Regex::new(&pattern) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Failed to compile regex pattern: {}", e);
            return uuids;
        }
    };

    for cap in re.captures_iter(html) {
        if let Some(uuid_match) = cap.get(1)
            && let Ok(uuid) = Uuid::parse_str(uuid_match.as_str())
        {
            uuids.insert(uuid);
        }
    }

    uuids
}

/// Loads already-processed message IDs to support resume functionality.
pub fn load_processed_message_ids(processed_file: &Path) -> anyhow::Result<HashSet<Uuid>> {
    if !processed_file.exists() {
        return Ok(HashSet::new());
    }

    let file = File::open(processed_file).context("Failed to open processed messages file")?;
    let reader = BufReader::new(file);
    let mut ids = HashSet::new();

    for line in reader.lines() {
        let line = line.context("Failed to read line from processed messages file")?;
        let trimmed = line.trim();
        if !trimmed.is_empty()
            && let Ok(id) = Uuid::parse_str(trimmed)
        {
            ids.insert(id);
        }
    }

    Ok(ids)
}

/// Appends multiple UUIDs to a file.
pub fn append_uuids_to_file(uuids: &HashSet<Uuid>, path: &Path) -> anyhow::Result<()> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .context("Failed to open used UUIDs file for appending")?;

    for uuid in uuids {
        writeln!(file, "{}", uuid).context("Failed to write UUID")?;
    }

    Ok(())
}

/// Loads existing used UUIDs from file to avoid duplicates.
pub fn load_existing_used_uuids(path: &Path) -> anyhow::Result<HashSet<Uuid>> {
    if !path.exists() {
        return Ok(HashSet::new());
    }

    let file = File::open(path).context("Failed to open used UUIDs file")?;
    let reader = BufReader::new(file);
    let mut uuids = HashSet::new();

    for line in reader.lines() {
        let line = line.context("Failed to read line from used UUIDs file")?;
        let trimmed = line.trim();
        if !trimmed.is_empty()
            && let Ok(uuid) = Uuid::parse_str(trimmed)
        {
            uuids.insert(uuid);
        }
    }

    Ok(uuids)
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_extract_sfs_uuids_basic() {
        let html = r#"<img src="https://static-file-service.macro.com/file/4e369509-666f-4d00-a321-4a7f0faa1304">"#;
        let uuids = extract_sfs_uuids(html, "static-file-service.macro.com");

        assert_eq!(uuids.len(), 1);
        assert!(uuids.contains(&Uuid::parse_str("4e369509-666f-4d00-a321-4a7f0faa1304").unwrap()));
    }

    #[test]
    fn test_extract_sfs_uuids_multiple() {
        let html = r#"
            <img src="https://static-file-service.macro.com/file/4e369509-666f-4d00-a321-4a7f0faa1304">
            <img src="https://static-file-service.macro.com/file/12345678-1234-1234-1234-123456789abc">
        "#;
        let uuids = extract_sfs_uuids(html, "static-file-service.macro.com");

        assert_eq!(uuids.len(), 2);
        assert!(uuids.contains(&Uuid::parse_str("4e369509-666f-4d00-a321-4a7f0faa1304").unwrap()));
        assert!(uuids.contains(&Uuid::parse_str("12345678-1234-1234-1234-123456789abc").unwrap()));
    }

    #[test]
    fn test_extract_sfs_uuids_no_match() {
        let html =
            r#"<img src="https://other-domain.com/file/4e369509-666f-4d00-a321-4a7f0faa1304">"#;
        let uuids = extract_sfs_uuids(html, "static-file-service.macro.com");

        assert!(uuids.is_empty());
    }

    #[test]
    fn test_extract_sfs_uuids_with_query_params() {
        let html = r#"<img src="https://static-file-service.macro.com/file/4e369509-666f-4d00-a321-4a7f0faa1304?size=thumb">"#;
        let uuids = extract_sfs_uuids(html, "static-file-service.macro.com");

        assert_eq!(uuids.len(), 1);
        assert!(uuids.contains(&Uuid::parse_str("4e369509-666f-4d00-a321-4a7f0faa1304").unwrap()));
    }

    #[test]
    fn test_extract_sfs_uuids_custom_domain() {
        let html = r#"<img src="https://custom.sfs.example.com/file/4e369509-666f-4d00-a321-4a7f0faa1304">"#;
        let uuids = extract_sfs_uuids(html, "custom.sfs.example.com");

        assert_eq!(uuids.len(), 1);
    }
}
