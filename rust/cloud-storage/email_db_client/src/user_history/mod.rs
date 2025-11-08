use anyhow::anyhow;
use models_email::service::message::ThreadHistoryInfo;
use sqlx::PgPool;
use sqlx::types::Uuid;
use std::collections::HashMap;

// upsert user_history row for user and thread
#[tracing::instrument(skip(pool), level = "info")]
pub async fn upsert_user_history(
    pool: &PgPool,
    link_id: Uuid,
    thread_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO email_user_history (link_id, thread_id, created_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (link_id, thread_id)
        DO UPDATE SET
            updated_at = NOW()
        "#,
        link_id,
        thread_id
    )
    .execute(pool)
    .await
    .map_err(|_| anyhow!("Failed to upsert user history"))?;

    Ok(())
}

// get history info for threads. created_at is when the first message was created, updated_at is when
// the latest message was created, viewed_at is the last time the thread was opened by the user
#[tracing::instrument(skip(pool), level = "info")]
pub async fn get_thread_summary_info(
    pool: &PgPool,
    link_id: Uuid,
    thread_ids: &[Uuid],
) -> anyhow::Result<HashMap<Uuid, ThreadHistoryInfo>> {
    if thread_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query!(
        r#"
        SELECT
            m.thread_id,
            MIN(m.created_at) as "earliest_created_at!",
            MAX(m.created_at) as "latest_updated_at!",
            uh.updated_at as "viewed_at?"
        FROM email_messages m
        LEFT JOIN email_user_history uh ON uh.thread_id = m.thread_id AND uh.link_id = $1
        WHERE m.thread_id = ANY($2)
        AND m.link_id = $1
        GROUP BY m.thread_id, uh.updated_at
        "#,
        link_id,
        thread_ids
    )
    .fetch_all(pool)
    .await
    .map_err(|e| anyhow!("Failed to fetch thread summary info: {}", e))?;

    let mut result = HashMap::new();

    for row in rows {
        let summary_info = ThreadHistoryInfo {
            item_id: row.thread_id,
            created_at: row.earliest_created_at,
            updated_at: row.latest_updated_at,
            viewed_at: row.viewed_at.and_then(|viewed| {
                if viewed >= row.latest_updated_at {
                    Some(viewed)
                } else {
                    None
                }
            }),
        };
        result.insert(row.thread_id, summary_info);
    }

    Ok(result)
}
