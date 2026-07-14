//! Fetch web citations for a chat.

use crate::domain::models::WebCitation;
use sqlx::PgPool;
use std::collections::HashMap;

/// Fetch web citations grouped by message ID.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn get_web_citations(
    pool: &PgPool,
    chat_id: &str,
) -> anyhow::Result<Vec<(String, Vec<WebCitation>)>> {
    let records = sqlx::query!(
        r#"
        SELECT
            "messageId" as "message_id",
            "url",
            "title",
            "description",
            "favicon_url",
            "image_url"
        FROM "WebAnnotations" wa
        INNER JOIN "ChatMessage" cm ON cm.id = wa."messageId"
        WHERE cm."chatId" = $1
        "#,
        chat_id
    )
    .fetch_all(pool)
    .await?;

    let mut citations: HashMap<String, Vec<WebCitation>> = HashMap::new();
    for record in records {
        let citation = WebCitation {
            url: record.url,
            title: record.title,
            description: record.description,
            image_url: record.image_url,
            favicon_url: record.favicon_url,
        };
        if let Some(id) = record.message_id {
            citations.entry(id).or_default().push(citation);
        }
    }

    Ok(citations.into_iter().collect())
}
