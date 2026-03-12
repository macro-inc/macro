//! Processing logic for reversing SFS mappings in email message HTML bodies.

use std::future::Future;
use std::time::Duration;

use anyhow::Context;
use regex::Regex;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

const QUERY_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_RETRIES: usize = 10;

/// Runs an async closure with a timeout, retrying up to MAX_RETRIES times.
async fn retry_with_timeout<F, Fut, T>(label: &str, f: F) -> anyhow::Result<T>
where
    F: Fn() -> Fut,
    Fut: Future<Output = anyhow::Result<T>>,
{
    for attempt in 1..=MAX_RETRIES {
        match tokio::time::timeout(QUERY_TIMEOUT, f()).await {
            Ok(Ok(result)) => return Ok(result),
            Ok(Err(e)) => {
                println!(
                    "  [RETRY] {} failed on attempt {}/{}: {:?}",
                    label, attempt, MAX_RETRIES, e
                );
                if attempt == MAX_RETRIES {
                    return Err(e)
                        .context(format!("{} failed after {} attempts", label, MAX_RETRIES));
                }
            }
            Err(_) => {
                println!(
                    "  [RETRY] {} timed out on attempt {}/{} ({}s limit)",
                    label,
                    attempt,
                    MAX_RETRIES,
                    QUERY_TIMEOUT.as_secs()
                );
                if attempt == MAX_RETRIES {
                    anyhow::bail!("{} timed out after {} attempts", label, MAX_RETRIES);
                }
            }
        }
    }
    unreachable!()
}

/// A message row with its id and HTML body.
#[derive(FromRow)]
pub struct MessageRow {
    pub id: Uuid,
    pub body_html_sanitized: Option<String>,
}

/// Fetches a batch of email messages using OFFSET/LIMIT pagination.
/// No server-side filtering — HTML parsing is done in the binary.
/// Retries with a 5s timeout per attempt.
pub async fn fetch_messages_batch(
    db: &PgPool,
    link_ids: &Option<Vec<Uuid>>,
    offset: i64,
    limit: i64,
) -> anyhow::Result<Vec<MessageRow>> {
    retry_with_timeout("fetch_messages_batch", || async {
        let rows = if let Some(link_ids) = link_ids {
            sqlx::query_as::<_, MessageRow>(
                "SELECT id, body_html_sanitized
                FROM public.email_messages
                WHERE link_id = ANY($1)
                  AND body_html_sanitized IS NOT NULL
                ORDER BY id
                OFFSET $2
                LIMIT $3",
            )
            .bind(link_ids)
            .bind(offset)
            .bind(limit)
            .fetch_all(db)
            .await
            .context("Failed to fetch messages batch")?
        } else {
            sqlx::query_as::<_, MessageRow>(
                "SELECT id, body_html_sanitized
                FROM public.email_messages
                WHERE body_html_sanitized IS NOT NULL
                ORDER BY id
                OFFSET $1
                LIMIT $2",
            )
            .bind(offset)
            .bind(limit)
            .fetch_all(db)
            .await
            .context("Failed to fetch messages batch")?
        };
        Ok(rows)
    })
    .await
}

/// Prints debug info about the link_ids and message counts to help diagnose issues.
pub async fn print_debug_info(db: &PgPool, link_ids: &Option<Vec<Uuid>>) -> anyhow::Result<()> {
    if let Some(link_ids) = link_ids {
        let existing_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM public.email_links WHERE id = ANY($1)")
                .bind(link_ids)
                .fetch_one(db)
                .await
                .context("Failed to count email_links")?;
        println!(
            "[DEBUG] email_links matching provided link_ids: {}",
            existing_count
        );

        let total_messages: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM public.email_messages WHERE link_id = ANY($1)",
        )
        .bind(link_ids)
        .fetch_one(db)
        .await
        .context("Failed to count messages")?;
        println!(
            "[DEBUG] Total messages for these link_ids: {}",
            total_messages
        );

        let with_html: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM public.email_messages WHERE link_id = ANY($1) AND body_html_sanitized IS NOT NULL",
        )
        .bind(link_ids)
        .fetch_one(db)
        .await
        .context("Failed to count messages with html")?;
        println!(
            "[DEBUG] Messages with non-null body_html_sanitized: {}",
            with_html
        );

        let with_sfs: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM public.email_messages WHERE link_id = ANY($1) AND body_html_sanitized LIKE '%static-file-service%'",
        )
        .bind(link_ids)
        .fetch_one(db)
        .await
        .context("Failed to count messages with sfs")?;
        println!(
            "[DEBUG] Messages containing 'static-file-service': {}",
            with_sfs
        );
    } else {
        let total_messages: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM public.email_messages")
            .fetch_one(db)
            .await
            .context("Failed to count messages")?;
        println!("[DEBUG] Total messages: {}", total_messages);

        let with_html: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM public.email_messages WHERE body_html_sanitized IS NOT NULL",
        )
        .fetch_one(db)
        .await
        .context("Failed to count messages with html")?;
        println!(
            "[DEBUG] Messages with non-null body_html_sanitized: {}",
            with_html
        );
    }

    println!();
    Ok(())
}

/// Extracts all URLs containing "static-file-service" from an HTML string.
pub fn extract_sfs_urls(html: &str) -> Vec<String> {
    let re =
        Regex::new(r#"https?://[^\s"'<>]*static-file-service[^\s"'<>]*"#).expect("Invalid regex");
    re.find_iter(html).map(|m| m.as_str().to_string()).collect()
}

/// Mapping row from email_sfs_mappings.
#[derive(FromRow)]
pub struct SfsMapping {
    pub source: String,
    pub destination: String,
}

/// Looks up original source URLs for multiple SFS destination URLs in a single query.
/// Returns a vec of (destination, source) pairs for found mappings.
/// Retries with a 5s timeout per attempt.
pub async fn lookup_source_urls_bulk(
    db: &PgPool,
    destination_urls: &[String],
) -> anyhow::Result<Vec<SfsMapping>> {
    if destination_urls.is_empty() {
        return Ok(vec![]);
    }

    retry_with_timeout("lookup_source_urls_bulk", || async {
        let rows = sqlx::query_as::<_, SfsMapping>(
            "SELECT source, destination
            FROM public.email_sfs_mappings
            WHERE destination = ANY($1)",
        )
        .bind(destination_urls)
        .fetch_all(db)
        .await
        .context("Failed to bulk lookup source URLs")?;
        Ok(rows)
    })
    .await
}

/// Bulk updates body_html_sanitized for multiple messages in a single query.
/// Uses unnest to join arrays of ids and html values.
/// Retries with a 5s timeout per attempt.
pub async fn bulk_update_message_html(
    db: &PgPool,
    ids: &[Uuid],
    htmls: &[String],
) -> anyhow::Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }

    retry_with_timeout("bulk_update_message_html", || async {
        let result = sqlx::query(
            "UPDATE public.email_messages AS m
            SET body_html_sanitized = v.new_html
            FROM unnest($1::uuid[], $2::text[]) AS v(id, new_html)
            WHERE m.id = v.id",
        )
        .bind(ids)
        .bind(htmls)
        .execute(db)
        .await
        .context("Failed to bulk update message HTML")?;
        Ok(result.rows_affected())
    })
    .await
}
