use crate::config::Mode;
use email_utils::body_replyless::reply_snippet;
use futures::stream::{self, StreamExt};
use rootcause::Report;
use sqlx::PgPool;
use uuid::Uuid;

#[cfg(test)]
mod test;

const PAGE_SIZE: i64 = 500;

/// A link and how many of its snippets were stale, or why it failed.
pub type LinkOutcome = (Uuid, Result<u64, Report>);

/// Backfills each Outlook link among `link_ids` (every Outlook link when
/// `None`) and returns each link's outcome.
#[tracing::instrument(
    name = "email.backfill_outlook_snippets",
    skip(pool, link_ids),
    fields(links),
    err
)]
pub async fn backfill(
    pool: &PgPool,
    link_ids: Option<Vec<Uuid>>,
    concurrency: usize,
    mode: Mode,
) -> Result<Vec<LinkOutcome>, Report> {
    let link_ids = sqlx::query_scalar!(
        "SELECT id FROM email_links WHERE provider = 'OUTLOOK' AND ($1::uuid[] IS NULL OR id = ANY($1)) ORDER BY id",
        link_ids.as_deref()
    )
    .fetch_all(pool)
    .await?;
    tracing::Span::current().record("links", link_ids.len());

    Ok(stream::iter(link_ids)
        .map(|link_id| async move { (link_id, backfill_link(pool, link_id, mode).await) })
        .buffer_unordered(concurrency)
        .collect()
        .await)
}

/// Pages the link's provider messages by `provider_id`, the only order the
/// `(link_id, provider_id)` index serves, and rewrites each snippet that
/// differs from the one ingest now derives from the same stored bodies. Rows
/// Outlook never sent (no `provider_id`) are left alone.
#[tracing::instrument(
    name = "email.backfill_outlook_snippets.link",
    skip(pool),
    fields(pages = 0u64, snippets),
    err
)]
async fn backfill_link(pool: &PgPool, link_id: Uuid, mode: Mode) -> Result<u64, Report> {
    let mut after = String::new();
    let mut pages = 0u64;
    let mut stale = 0;
    loop {
        let page = sqlx::query!(
            r#"
            SELECT id, provider_id AS "provider_id!", subject, body_html_sanitized, body_text, snippet
            FROM email_messages
            WHERE link_id = $1 AND provider_id > $2
            ORDER BY provider_id
            LIMIT $3
            "#,
            link_id,
            after,
            PAGE_SIZE
        )
        .fetch_all(pool)
        .await?;
        let Some(last) = page.last() else {
            let span = tracing::Span::current();
            span.record("pages", pages);
            span.record("snippets", stale);
            tracing::info!(snippets = stale, "link done");
            return Ok(stale);
        };
        after = last.provider_id.clone();
        pages += 1;

        let mut ids = Vec::new();
        let mut stored = Vec::new();
        let mut snippets = Vec::new();
        for row in page {
            let Some(snippet) = reply_snippet(
                row.subject.as_deref(),
                row.body_html_sanitized.as_deref(),
                row.body_text.as_deref(),
            ) else {
                continue;
            };
            if row.snippet.as_ref() != Some(&snippet) {
                ids.push(row.id);
                stored.push(row.snippet);
                snippets.push(snippet);
            }
        }

        stale += match mode {
            Mode::Verify => ids.len() as u64,
            // The stored-snippet guard skips rows ingest rewrote since the read.
            Mode::Apply => sqlx::query!(
                r#"
                UPDATE email_messages m SET snippet = v.snippet
                FROM UNNEST($1::uuid[], $2::text[], $3::text[]) AS v(id, stored, snippet)
                WHERE m.id = v.id AND m.snippet IS NOT DISTINCT FROM v.stored
                "#,
                &ids,
                &stored as &[Option<String>],
                &snippets
            )
            .execute(pool)
            .await?
            .rows_affected(),
        };
    }
}
