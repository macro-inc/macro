//! Short attempt leases release every database connection before engine IO.
//!
//! Key-scoped writes lock the owned primary-key row before testing mutable
//! fences, so stale partial-index statistics cannot turn them into queue scans.

use super::*;

pub(super) async fn lease(
    repo: &PgImapConnections,
    attempt: &ImapConnectionAttempt,
) -> Result<ImapConnectionLease, ImapConnectionError> {
    let nonce = macro_uuid::generate_uuid_v7();
    let age = sqlx::query_scalar!(
        r#"
        WITH locked AS MATERIALIZED (
            SELECT id, completed, lease_until
            FROM email_imap_connection_attempts
            WHERE id = $1 AND user_id = $2
            FOR UPDATE
        )
        UPDATE email_imap_connection_attempts a
        SET lease_id = $3,
            lease_until = now() + interval '5 minutes',
            updated_at = now()
        FROM locked
        WHERE a.id = $1 AND a.id = locked.id
            AND NOT locked.completed
            AND (locked.lease_until IS NULL OR locked.lease_until <= now())
        RETURNING EXTRACT(epoch FROM now() - a.created_at)::bigint AS "age_seconds!"
        "#,
        attempt.id,
        attempt.owner.as_ref(),
        nonce,
    )
    .fetch_optional(&repo.0)
    .await
    .map_err(failure)?
    .ok_or(ImapConnectionError::Changed)?;
    Ok(ImapConnectionLease {
        attempt: attempt.clone(),
        nonce,
        age: chrono::Duration::seconds(age.max(0)),
    })
}

pub(super) async fn claim_pending(
    repo: &PgImapConnections,
) -> Result<Option<ImapConnectionLease>, ImapConnectionError> {
    let mut tx = repo.0.begin().await.map_err(failure)?;
    sqlx::query!("SET LOCAL statement_timeout = '15s'")
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
    let nonce = macro_uuid::generate_uuid_v7();
    // The finite predicate is the partial-index contract; now() alone cannot
    // prove it. Completed receipts map to infinity and never enter this index.
    let row = sqlx::query!(
        r#"
        WITH due AS MATERIALIZED (
            SELECT id
            FROM email_imap_connection_attempts
            WHERE (CASE WHEN completed THEN 'infinity'::timestamptz
                    ELSE GREATEST(recovery_at, COALESCE(lease_until, '-infinity'::timestamptz))
                END) < 'infinity'::timestamptz
                AND (CASE WHEN completed THEN 'infinity'::timestamptz
                    ELSE GREATEST(recovery_at, COALESCE(lease_until, '-infinity'::timestamptz))
                END) <= now()
            ORDER BY (CASE WHEN completed THEN 'infinity'::timestamptz
                    ELSE GREATEST(recovery_at, COALESCE(lease_until, '-infinity'::timestamptz))
                END), id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        UPDATE email_imap_connection_attempts a
        SET lease_id = $1,
            lease_until = now() + interval '5 minutes',
            updated_at = now()
        FROM due
        WHERE a.id = due.id
        RETURNING a.id, a.user_id,
            EXTRACT(epoch FROM now() - a.created_at)::bigint AS "age_seconds!"
        "#,
        nonce,
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(failure)?;
    tx.commit().await.map_err(failure)?;
    let Some(row) = row else {
        return Ok(None);
    };
    let actor =
        MacroUserIdStr::try_from(row.user_id).map_err(|_| ImapConnectionError::Unavailable)?;
    let attempt = repo
        .attempt(&actor, row.id)
        .await?
        .ok_or(ImapConnectionError::Changed)?;
    Ok(Some(ImapConnectionLease {
        attempt,
        nonce,
        age: chrono::Duration::seconds(row.age_seconds.max(0)),
    }))
}

pub(super) async fn defer(
    repo: &PgImapConnections,
    lease: &ImapConnectionLease,
    delay: chrono::Duration,
) -> Result<(), ImapConnectionError> {
    let changed = sqlx::query!(
        r#"
        WITH locked AS MATERIALIZED (
            SELECT id, completed, lease_id, lease_until
            FROM email_imap_connection_attempts
            WHERE id = $1 AND user_id = $2
            FOR UPDATE
        )
        UPDATE email_imap_connection_attempts a
        SET recovery_at = GREATEST(a.created_at + interval '2 minutes',
                now() + $4::bigint * interval '1 second'),
            lease_id = NULL,
            lease_until = NULL,
            updated_at = now()
        FROM locked
        WHERE a.id = $1 AND a.id = locked.id
            AND NOT locked.completed
            AND locked.lease_id = $3
            AND locked.lease_until > now()
        "#,
        lease.attempt.id,
        lease.attempt.owner.as_ref(),
        lease.nonce,
        delay.num_seconds(),
    )
    .execute(&repo.0)
    .await
    .map_err(failure)?;
    if changed.rows_affected() != 1 {
        return Err(ImapConnectionError::Changed);
    }
    Ok(())
}
