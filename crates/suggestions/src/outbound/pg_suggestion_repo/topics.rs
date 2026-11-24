//! Topics: reading the person's and naming them.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use crate::domain::model::GenerationSession;
use crate::domain::topic::{NameTopic, StoredTopic};

#[cfg(test)]
mod test;

/// Those of the person's topics `keys` that exist.
pub(super) async fn topics(
    pool: &PgPool,
    user: &MacroUserIdStr<'_>,
    keys: &[String],
) -> Result<Vec<StoredTopic>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query!("SET LOCAL statement_timeout = '5s'")
        .execute(&mut *tx)
        .await?;
    let topics = sqlx::query_as!(
        StoredTopic,
        r#"SELECT t.key, t.name, t.reason, t.updated_at, s.settled_at AS "settled_at?"
           FROM unnest($2::text[]) AS wanted(key)
           CROSS JOIN LATERAL (
               SELECT * FROM suggestion_topic
               WHERE user_id = $1 AND key = wanted.key
               LIMIT 1
           ) t
           LEFT JOIN LATERAL (
               SELECT i.state_changed_at AS settled_at FROM suggestion i
               WHERE i.user_id = t.user_id AND i.topic_key = t.key
                 AND i.state IN ('done', 'resolved')
               ORDER BY i.state_changed_at DESC
               LIMIT 1
           ) s ON true"#,
        user.as_ref(),
        keys,
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(topics)
}

/// Store a topic a session names; false when its generation named `limit`
/// others already.
pub(super) async fn name_topic(
    pool: &PgPool,
    session: &GenerationSession,
    topic: &NameTopic,
    limit: u32,
    at: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    suggestions_db_utils::lock_user(&mut tx, session.user.as_ref()).await?;
    // Naming one this generation named already is no new topic.
    let others = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM suggestion_topic
           WHERE generation_id = $1 AND key <> $2"#,
        session.generation,
        topic.key,
    )
    .fetch_one(&mut *tx)
    .await?;
    if others >= i64::from(limit) {
        return Ok(false);
    }
    sqlx::query!(
        r#"INSERT INTO suggestion_topic
             (user_id, key, name, reason, session_id, generation_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
           ON CONFLICT (user_id, key) DO UPDATE
           SET name = EXCLUDED.name, reason = EXCLUDED.reason,
               session_id = EXCLUDED.session_id, generation_id = EXCLUDED.generation_id,
               updated_at = EXCLUDED.updated_at"#,
        session.user.as_ref(),
        topic.key,
        topic.name,
        topic.reason.as_deref(),
        session.session,
        session.generation,
        at,
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(true)
}
