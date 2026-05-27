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

/// Counts messages with non-null body_html_sanitized for the given link_ids (or all if None).
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub async fn count_messages(db: &PgPool, link_ids: &Option<Vec<Uuid>>) -> anyhow::Result<i64> {
    let count: i64 = if let Some(link_ids) = link_ids {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM public.email_messages WHERE link_id = ANY($1) AND body_html_sanitized IS NOT NULL",
        )
        .bind(link_ids)
        .fetch_one(db)
        .await
        .context("Failed to count messages")?
    } else {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM public.email_messages WHERE body_html_sanitized IS NOT NULL",
        )
        .fetch_one(db)
        .await
        .context("Failed to count messages")?
    };
    Ok(count)
}

/// Fetches all message IDs for a single link_id where body_html_sanitized is not null.
/// Uses the (link_id) index for filtering.
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub async fn fetch_message_ids_for_link(db: &PgPool, link_id: Uuid) -> anyhow::Result<Vec<Uuid>> {
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM public.email_messages WHERE link_id = $1 AND body_html_sanitized IS NOT NULL",
    )
    .bind(link_id)
    .fetch_all(db)
    .await
    .context("Failed to fetch message IDs for link_id")?;
    Ok(ids)
}

/// Fetches all message IDs where body_html_sanitized is not null (no link_id filter).
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub async fn fetch_all_message_ids(db: &PgPool) -> anyhow::Result<Vec<Uuid>> {
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM public.email_messages WHERE body_html_sanitized IS NOT NULL",
    )
    .fetch_all(db)
    .await
    .context("Failed to fetch all message IDs")?;
    Ok(ids)
}

/// Fetches messages by their IDs. Uses PK index directly.
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub async fn fetch_messages_by_ids(db: &PgPool, ids: &[Uuid]) -> anyhow::Result<Vec<MessageRow>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }

    retry_with_timeout("fetch_messages_by_ids", || async {
        let rows = sqlx::query_as::<_, MessageRow>(
            "SELECT id, body_html_sanitized
            FROM public.email_messages
            WHERE id = ANY($1)",
        )
        .bind(ids)
        .fetch_all(db)
        .await
        .context("Failed to fetch messages by IDs")?;
        Ok(rows)
    })
    .await
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
/// Retries with a 5s timeout per attempt.
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
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
/// Retries with a 5s timeout per attempt.
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
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
