//! Uncommitted command claim; loading failure or cancellation rolls it back.
use super::*;
impl PgRepository {
    pub(super) async fn begin_acquisition(
        &self,
        b: Binding,
    ) -> Result<(sqlx::Transaction<'_, sqlx::Postgres>, Account), Error> {
        let mut tx = self.pool.begin().await.map_err(load_error)?;
        sqlx::query!("SET LOCAL statement_timeout = '30s'")
            .execute(&mut *tx)
            .await
            .map_err(load_error)?;
        // Full sync hydration includes mailbox-sized CPU work between queries.
        // Its idle backstop follows the admitted round budget, not a short read.
        let idle_ms = SYNC_ROUND_BUDGET.as_millis().to_string();
        sqlx::query!(
            r#"
            SELECT
                set_config('idle_in_transaction_session_timeout', $1, true)
            "#,
            idle_ms,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(load_error)?;
        // A peer must fail fast instead of waiting for a loading transaction's
        // row lock. Its generation/active/owner checks still run in the UPDATE.
        sqlx::query_scalar!(
            r#"
            SELECT
                link_id
            FROM
                imap_accounts
            WHERE
                link_id = $1
            FOR NO KEY UPDATE NOWAIT
            "#,
            b.link_id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| {
            if error
                .as_database_error()
                .is_some_and(|error| error.code().as_deref() == Some("55P03"))
            {
                record_outcome(AcquireOutcome::LockBusy);
                Error::Throttled
            } else {
                load_error(error)
            }
        })?
        .ok_or_else(|| {
            record_outcome(AcquireOutcome::Conflict);
            Error::Conflict
        })?;
        let lease = Uuid::now_v7();
        let row = sqlx::query!(
            r#"
            UPDATE
                imap_accounts a
            SET
                lease_id = $4,
                lease_until = now() + interval '5 minutes'
            FROM
                email_links l
            WHERE
                a.link_id = $1
                AND a.sync_generation = $2
                AND a.grant_generation = $3
                AND (a.lease_until IS NULL
                    OR a.lease_until < now())
                AND l.id = a.link_id
                AND l.macro_id = a.user_id
                AND l.provider = 'IMAP'
                AND l.is_sync_active
                AND NOT l.needs_reauth
                AND l.sync_generation = a.sync_generation
                AND l.grant_generation = a.grant_generation
            RETURNING
                a.user_id,
                a.credential_ciphertext,
                a.state,
                a.revision
            "#,
            b.link_id,
            b.sync_generation,
            b.grant_generation,
            lease,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(load_error)?;
        let r = match row {
            Some(row) => row,
            None => {
                let current = sqlx::query_scalar!(
                    r#"
                    SELECT
                        EXISTS (
                            SELECT
                                1
                            FROM
                                imap_accounts a
                                JOIN email_links l ON l.id = a.link_id
                            WHERE
                                a.link_id = $1
                                AND a.sync_generation = $2
                                AND a.grant_generation = $3
                                AND l.macro_id = a.user_id
                                AND l.provider = 'IMAP'
                                AND l.is_sync_active
                                AND NOT l.needs_reauth
                                AND l.sync_generation = a.sync_generation
                                AND l.grant_generation = a.grant_generation) AS "current!"
                    "#,
                    b.link_id,
                    b.sync_generation,
                    b.grant_generation,
                )
                .fetch_one(&mut *tx)
                .await
                .map_err(load_error)?;
                return Err(if current {
                    record_outcome(AcquireOutcome::LeaseHeld);
                    Error::Throttled
                } else {
                    record_outcome(AcquireOutcome::Conflict);
                    Error::Conflict
                });
            }
        };
        let account = Account {
            checkpoint: Default::default(),
            binding: b,
            user_id: r.user_id,
            ciphertext: r.credential_ciphertext,
            state: serde_json::from_value(r.state).map_err(|_| {
                record_outcome(AcquireOutcome::InvalidState);
                Error::ConnectionUnavailable
            })?,
            revision: r.revision,
            lease_id: Some(lease),
        };
        Ok((tx, account))
    }
}

#[derive(strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub(super) enum AcquireOutcome {
    Acquired,
    LockBusy,
    LeaseHeld,
    Conflict,
    StatementTimeout,
    IdleTimeout,
    Unavailable,
    InvalidState,
}

pub(super) fn record_outcome(outcome: AcquireOutcome) {
    tracing::Span::current().record("acquire.outcome", outcome.as_ref());
}

pub(super) fn load_error(error: sqlx::Error) -> Error {
    let code = error.as_database_error().and_then(|error| error.code());
    let outcome = match code.as_deref() {
        Some("57014") => AcquireOutcome::StatementTimeout,
        Some("25P03") => AcquireOutcome::IdleTimeout,
        _ => AcquireOutcome::Unavailable,
    };
    record_outcome(outcome);
    Error::ConnectionUnavailable
}
