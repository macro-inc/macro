#![deny(missing_docs)]
//! Transactional helpers for the `suggestion` tables, for writes that must
//! commit with another crate's: a routine suggestion and its `routine`
//! suggestion are kept, dismissed, retired and saved together. The `suggestions` crate's repository
//! builds on the same helpers.

use chrono::{DateTime, Utc};
use macro_uuid::Uuid;
use serde_json::Value;
use sqlx::PgConnection;

#[cfg(test)]
mod test;

/// Whether one more open suggestion fits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Room {
    /// It fits.
    Fits,
    /// The person has the most open suggestions they may have.
    OpenFull,
    /// The generation added the most it may.
    GenerationFull,
}

/// One change a generation session made to a suggestion, for the change log.
#[derive(Debug, Clone, PartialEq)]
pub struct SuggestionChange<'a> {
    /// The generation it belongs to.
    pub generation: Uuid,
    /// The session that made it.
    pub session: Uuid,
    /// `created`, `rewritten`, `retired` or `restored`.
    pub action: &'a str,
    /// The value before.
    pub old: Option<Value>,
    /// The value after.
    pub new: Option<Value>,
    /// The session's reason.
    pub reason: Option<&'a str>,
    /// When.
    pub at: DateTime<Utc>,
}

/// Serialize writes to `user`'s suggestions for the rest of the transaction, so
/// limits hold under concurrent writes.
pub async fn lock_user(conn: &mut PgConnection, user: &str) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended('suggestion:' || $1, 0))",
        user,
    )
    .fetch_one(conn)
    .await?;
    Ok(())
}

/// Whether one more open suggestion fits `user`'s `open` limit and
/// `generation`'s `per_generation` limit. Call under [`lock_user`].
pub async fn room(
    conn: &mut PgConnection,
    user: &str,
    generation: Uuid,
    open: u32,
    per_generation: u32,
) -> Result<Room, sqlx::Error> {
    let counts = sqlx::query!(
        r#"SELECT
             (SELECT count(*) FROM suggestion
              WHERE user_id = $1 AND state IN ('proposed', 'accepted')) AS "open!",
             (SELECT count(*) FROM suggestion_change
              WHERE generation_id = $2 AND subject = 'suggestion'
                AND action IN ('created', 'restored')) AS "added!""#,
        user,
        generation,
    )
    .fetch_one(conn)
    .await?;
    if counts.open >= i64::from(open) {
        return Ok(Room::OpenFull);
    }
    if counts.added >= i64::from(per_generation) {
        return Ok(Room::GenerationFull);
    }
    Ok(Room::Fits)
}

/// Log `change` to suggestion `suggestion` of `user`'s.
pub async fn log_change(
    conn: &mut PgConnection,
    user: &str,
    suggestion: Uuid,
    change: &SuggestionChange<'_>,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"INSERT INTO suggestion_change
             (id, user_id, generation_id, session_id, subject, subject_id, action,
              old_value, new_value, reason, created_at)
           VALUES ($1, $2, $3, $4, 'suggestion', $5, $6, $7, $8, $9, $10)"#,
        Uuid::now_v7(),
        user,
        change.generation,
        change.session,
        suggestion,
        change.action,
        change.old,
        change.new,
        change.reason,
        change.at,
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A routine suggestion for a routine suggestion a session just kept.
#[derive(Debug, Clone, PartialEq)]
pub struct NewRoutineSuggestionCard<'a> {
    /// Whose.
    pub user: &'a str,
    /// The suggestion it shows.
    pub suggestion: Uuid,
    /// What to do, in a few words.
    pub title: &'a str,
    /// Why: the suggestion's reason.
    pub summary: &'a str,
    /// 0 to 100.
    pub importance: i16,
    /// The feed's filters it shows under, by wire name.
    pub categories: &'a [String],
    /// The routines session that suggested it.
    pub session: Uuid,
    /// Its generation.
    pub generation: Uuid,
    /// When.
    pub at: DateTime<Utc>,
}

/// Add `suggestion`, logged as created, within the `open` and `per_generation`
/// limits; whether it fit. Takes the person's lock.
pub async fn add_routine_card(
    conn: &mut PgConnection,
    card: &NewRoutineSuggestionCard<'_>,
    open: u32,
    per_generation: u32,
) -> Result<Room, sqlx::Error> {
    lock_user(conn, card.user).await?;
    let room = room(conn, card.user, card.generation, open, per_generation).await?;
    if room != Room::Fits {
        return Ok(room);
    }
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO suggestion
             (id, user_id, kind, dedup_key, title, summary, importance, categories,
              session_id, created_at, updated_at, state_changed_at)
           VALUES ($1, $2, 'routine', $3, $4, $5, $6, $7, $8, $9, $9, $9)"#,
        id,
        card.user,
        format!("routine_suggestion:{}", card.suggestion),
        card.title,
        card.summary,
        card.importance,
        card.categories,
        card.session,
        card.at,
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        "INSERT INTO suggestion_routine (suggestion_id, routine_suggestion_id) VALUES ($1, $2)",
        id,
        card.suggestion,
    )
    .execute(&mut *conn)
    .await?;
    log_change(
        conn,
        card.user,
        id,
        &SuggestionChange {
            generation: card.generation,
            session: card.session,
            action: "created",
            old: None,
            new: Some(serde_json::json!({ "title": card.title, "importance": card.importance })),
            reason: Some(card.summary),
            at: card.at,
        },
    )
    .await?;
    Ok(Room::Fits)
}

/// Move the open routine suggestion of suggestion `suggestion` to `state`
/// (`dismissed` or `retired`), logging `change` when given; whether there
/// was one.
pub async fn close_routine_card(
    conn: &mut PgConnection,
    suggestion: Uuid,
    state: &str,
    change: Option<&SuggestionChange<'_>>,
    at: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    let closed = sqlx::query!(
        r#"UPDATE suggestion SET state = $2, state_reason = NULL, updated_at = $3, state_changed_at = $3
           WHERE id = (SELECT suggestion_id FROM suggestion_routine WHERE routine_suggestion_id = $1)
             AND state IN ('proposed', 'accepted')
           RETURNING id, user_id"#,
        suggestion,
        state,
        at,
    )
    .fetch_optional(&mut *conn)
    .await?;
    if let (Some(closed), Some(change)) = (&closed, change) {
        log_change(conn, &closed.user_id, closed.id, change).await?;
    }
    Ok(closed.is_some())
}

/// `owner` saved routine `routine` from suggestion `suggestion`: their
/// open routine suggestion for it is done, and produced the routine. Someone
/// else's suggestion changes nothing.
pub async fn complete_routine_card(
    conn: &mut PgConnection,
    owner: &str,
    suggestion: Uuid,
    routine: Uuid,
    at: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    let done = sqlx::query_scalar!(
        r#"UPDATE suggestion SET state = 'done', state_reason = NULL, updated_at = $2, state_changed_at = $2
           WHERE id = (SELECT suggestion_id FROM suggestion_routine WHERE routine_suggestion_id = $1)
             AND user_id = $3
             AND state IN ('proposed', 'accepted')
           RETURNING id"#,
        suggestion,
        at,
        owner,
    )
    .fetch_optional(&mut *conn)
    .await?;
    let Some(card) = done else {
        return Ok(false);
    };
    sqlx::query!(
        r#"INSERT INTO suggestion_target (suggestion_id, role, position, entity_type, entity_id)
           VALUES ($1, 'produced',
                   (SELECT count(*) FROM suggestion_target WHERE suggestion_id = $1 AND role = 'produced')::smallint,
                   'scheduled_action', $2)"#,
        card,
        routine.to_string(),
    )
    .execute(conn)
    .await?;
    Ok(true)
}
