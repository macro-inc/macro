//! Topics: reading the person's and naming them.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use super::parse;
use crate::domain::model::{GenerationSession, Target};
use crate::domain::topic::{NameTopic, StoredTopic, TopicReason};

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
    let rows = sqlx::query!(
        r#"SELECT t.key, t.name, t.reason, t.reason_entity_type, t.reason_entity_id,
                  t.reason_part_id, t.updated_at, s.settled_at AS "settled_at?"
           FROM unnest($2::text[]) AS wanted(key)
           CROSS JOIN LATERAL (
               SELECT * FROM suggestion_topic
               WHERE user_id = $1 AND key = wanted.key
               LIMIT 1
           ) t
           CROSS JOIN LATERAL (
               SELECT max(latest.state_changed_at) AS settled_at
               FROM unnest(ARRAY['done', 'resolved']) AS settled(state)
               CROSS JOIN LATERAL (
                   SELECT i.state_changed_at FROM suggestion i
                   WHERE i.user_id = t.user_id AND i.topic_key = t.key
                     AND i.state = settled.state
                   ORDER BY i.state_changed_at DESC
                   LIMIT 1
               ) latest
           ) s"#,
        user.as_ref(),
        keys,
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(rows
        .into_iter()
        .map(|row| StoredTopic {
            reason: reason(
                row.reason,
                row.reason_entity_type,
                row.reason_entity_id,
                row.reason_part_id,
            ),
            key: row.key,
            name: row.name,
            updated_at: row.updated_at,
            settled_at: row.settled_at,
        })
        .collect())
}

/// A reason as stored; none when its source is of a type this build doesn't
/// know, so it can't be checked.
fn reason(
    text: Option<String>,
    entity_type: Option<String>,
    entity_id: Option<String>,
    part_id: Option<String>,
) -> Option<TopicReason> {
    let entity_type = parse(&entity_type?)
        .inspect_err(|error| tracing::warn!(?error, "unreadable topic source"))
        .ok()?;
    Some(TopicReason {
        text: text?,
        source: Target {
            entity_type,
            entity_id: entity_id?,
            part_id,
        },
    })
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
    // Naming one this generation named already is no new topic. One more than
    // the limit is read, in the index's order, so the count is bounded.
    let others = sqlx::query_scalar!(
        r#"SELECT count(*) FILTER (WHERE named.key <> $2) AS "count!" FROM (
               SELECT key FROM suggestion_topic
               WHERE generation_id = $1
               ORDER BY key
               LIMIT $3
           ) named"#,
        session.generation,
        topic.key,
        i64::from(limit) + 1,
    )
    .fetch_one(&mut *tx)
    .await?;
    if others >= i64::from(limit) {
        return Ok(false);
    }
    let source = topic.reason.as_ref().map(|reason| &reason.source);
    sqlx::query!(
        r#"INSERT INTO suggestion_topic
             (user_id, key, name, reason, reason_entity_type, reason_entity_id, reason_part_id,
              session_id, generation_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
           ON CONFLICT (user_id, key) DO UPDATE
           SET name = EXCLUDED.name, reason = EXCLUDED.reason,
               reason_entity_type = EXCLUDED.reason_entity_type,
               reason_entity_id = EXCLUDED.reason_entity_id,
               reason_part_id = EXCLUDED.reason_part_id,
               session_id = EXCLUDED.session_id, generation_id = EXCLUDED.generation_id,
               updated_at = EXCLUDED.updated_at"#,
        session.user.as_ref(),
        topic.key,
        topic.name,
        topic.reason.as_ref().map(|reason| reason.text.as_str()),
        source.map(|source| source.entity_type.as_ref()),
        source.map(|source| source.entity_id.as_str()),
        source.and_then(|source| source.part_id.as_deref()),
        session.session,
        session.generation,
        at,
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(true)
}
