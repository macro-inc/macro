//! [`ScreenRepo`] over MacroDB's `computer_screen_*` tables.

use std::time::Duration;

use chrono::{DateTime, Utc};
use computer_id::ComputerId;
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::domain::models::{
    AgentNotice, DriveEnd, DriveId, Driver, EndReason, Lease, NoticeClaim, NoticeName, OwedThaw,
    PendingNotice, RedeemedTicket, Release, ScreenGrant, SessionId, TakeOver, ThawSettled,
};
use crate::domain::ports::{ScreenRepo, TicketHash};

#[cfg(test)]
mod test;

/// `pg_notify` channel of lease changes; the payload is the computer id.
pub const LEASE_CHANGED_CHANNEL: &str = "computer_screen_lease_changed";

/// A storage failure.
#[derive(Debug, thiserror::Error)]
pub enum PgScreenError {
    /// The query failed.
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    /// A stored value doesn't parse.
    #[error("corrupt screen row: {0}")]
    Corrupt(&'static str),
    /// A notice didn't serialize.
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    /// The lease kept changing hands under a take-over.
    #[error("the lease kept changing during a take-over")]
    Contended,
}

/// The screen tables on `pool`.
#[derive(Debug, Clone)]
pub struct PgScreenRepo {
    pool: PgPool,
}

impl PgScreenRepo {
    /// Read and write on `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// A lease row as stored.
struct LeaseRow {
    computer_id: Uuid,
    session_id: Uuid,
    user_id: String,
    driver_name: Option<String>,
    agent_user_id: Option<String>,
    started_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
}

impl TryFrom<LeaseRow> for Lease {
    type Error = PgScreenError;

    fn try_from(row: LeaseRow) -> Result<Self, PgScreenError> {
        Ok(Lease {
            computer_id: ComputerId::new_from_uuid(row.computer_id),
            session_id: SessionId::from_uuid(row.session_id),
            driver: Driver {
                user_id: user_id(row.user_id)?,
                name: row.driver_name,
            },
            agent_user_id: row.agent_user_id.map(user_id).transpose()?,
            started_at: row.started_at,
            expires_at: row.expires_at,
        })
    }
}

fn user_id(value: String) -> Result<MacroUserIdStr<'static>, PgScreenError> {
    MacroUserIdStr::try_from(value).map_err(|_| PgScreenError::Corrupt("user id"))
}

fn ttl_seconds(ttl: Duration) -> f64 {
    ttl.as_secs_f64()
}

impl ScreenRepo for PgScreenRepo {
    type Err = PgScreenError;

    #[tracing::instrument(skip_all, err)]
    async fn insert_ticket(
        &self,
        hash: TicketHash,
        grant: &ScreenGrant,
        traceparent: Option<&str>,
        expires_at: DateTime<Utc>,
    ) -> Result<(), PgScreenError> {
        // Expired tickets go with each new one; the index keeps it cheap.
        sqlx::query!(
            "DELETE FROM computer_screen_tickets WHERE expires_at < now() - interval '1 hour'"
        )
        .execute(&self.pool)
        .await?;
        // So do notices no agent picked up within a day (its computer was
        // released, or it stopped): they are never delivered after that.
        sqlx::query!(
            "DELETE FROM computer_screen_agent_notices WHERE created_at < now() - interval '1 day'"
        )
        .execute(&self.pool)
        .await?;
        sqlx::query!(
            r#"
            INSERT INTO computer_screen_tickets
                (token_hash, harness_id, computer_id, agent_user_id, user_id, transport, surface, mode,
                 traceparent, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            "#,
            &hash[..],
            grant.harness_id.as_uuid(),
            grant.computer_id.as_uuid(),
            grant.agent_user_id.as_ref().map(|agent| agent.as_ref()),
            grant.user_id.as_ref(),
            grant.transport.as_ref(),
            grant.surface.as_ref(),
            grant.mode.as_ref(),
            traceparent,
            expires_at,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn redeem_ticket(
        &self,
        hash: TicketHash,
    ) -> Result<Option<RedeemedTicket>, PgScreenError> {
        let row = sqlx::query!(
            r#"
            DELETE FROM computer_screen_tickets
            WHERE token_hash = $1
            RETURNING harness_id, computer_id, agent_user_id, user_id, transport, surface, mode, traceparent,
                      expires_at > now() AS "live!"
            "#,
            &hash[..],
        )
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row.filter(|row| row.live) else {
            return Ok(None);
        };
        let grant = ScreenGrant {
            harness_id: HarnessId::new_from_uuid(row.harness_id),
            computer_id: ComputerId::new_from_uuid(row.computer_id),
            agent_user_id: row.agent_user_id.map(user_id).transpose()?,
            user_id: user_id(row.user_id)?,
            transport: row
                .transport
                .parse()
                .map_err(|_| PgScreenError::Corrupt("transport"))?,
            surface: row
                .surface
                .parse()
                .map_err(|_| PgScreenError::Corrupt("surface"))?,
            mode: row
                .mode
                .parse()
                .map_err(|_| PgScreenError::Corrupt("mode"))?,
        };
        Ok(Some(RedeemedTicket {
            grant,
            traceparent: row.traceparent,
        }))
    }

    #[tracing::instrument(skip_all, fields(screen.session.id = %id), err)]
    async fn start_session(&self, id: SessionId, grant: &ScreenGrant) -> Result<(), PgScreenError> {
        sqlx::query!(
            r#"
            INSERT INTO computer_screen_sessions
                (id, harness_id, computer_id, user_id, transport, surface, mode)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
            id.as_uuid(),
            grant.harness_id.as_uuid(),
            grant.computer_id.as_uuid(),
            grant.user_id.as_ref(),
            grant.transport.as_ref(),
            grant.surface.as_ref(),
            grant.mode.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(computer.id = %computer), err)]
    async fn end_lost_sessions(
        &self,
        computer: ComputerId,
        fresh: Duration,
    ) -> Result<u64, PgScreenError> {
        let ended = sqlx::query!(
            r#"
            UPDATE computer_screen_sessions
            SET ended_at = seen_at, end_reason = $3
            WHERE computer_id = $1
              AND ended_at IS NULL
              AND seen_at < now() - make_interval(secs => $2)
            "#,
            computer.as_uuid(),
            ttl_seconds(fresh),
            EndReason::Lost.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(ended.rows_affected())
    }

    #[tracing::instrument(skip_all, fields(screen.session.id = %id), err)]
    async fn touch_session(&self, id: SessionId) -> Result<bool, PgScreenError> {
        let touched = sqlx::query!(
            r#"
            UPDATE computer_screen_sessions SET seen_at = now()
            WHERE id = $1 AND ended_at IS NULL
            "#,
            id.as_uuid(),
        )
        .execute(&self.pool)
        .await?;
        Ok(touched.rows_affected() > 0)
    }

    #[tracing::instrument(skip_all, fields(computers = computers.len()), err)]
    async fn computers_in_use(
        &self,
        computers: &[ComputerId],
        fresh: Duration,
    ) -> Result<Vec<ComputerId>, PgScreenError> {
        let ids: Vec<Uuid> = computers
            .iter()
            .map(|computer| computer.as_uuid())
            .collect();
        let fresh_seconds = ttl_seconds(fresh);
        let rows = sqlx::query_scalar!(
            r#"
            SELECT DISTINCT session.computer_id AS "computer_id!"
            FROM computer_screen_sessions session
            WHERE session.computer_id = ANY($1)
              AND session.ended_at IS NULL
              AND session.seen_at > now() - make_interval(secs => $2)
            UNION
            SELECT lease.computer_id
            FROM computer_screen_driver_leases lease
            WHERE lease.computer_id = ANY($1) AND lease.expires_at > now()
            "#,
            &ids,
            fresh_seconds,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(ComputerId::new_from_uuid).collect())
    }

    #[tracing::instrument(skip_all, fields(screen.session.id = %id), err)]
    async fn end_session(
        &self,
        id: SessionId,
        reason: EndReason,
        bytes_to_viewer: u64,
        bytes_from_viewer: u64,
    ) -> Result<(), PgScreenError> {
        sqlx::query!(
            r#"
            UPDATE computer_screen_sessions
            SET ended_at = now(), end_reason = $2, bytes_to_viewer = $3, bytes_from_viewer = $4
            WHERE id = $1 AND ended_at IS NULL
            "#,
            id.as_uuid(),
            reason.as_ref(),
            i64::try_from(bytes_to_viewer).unwrap_or(i64::MAX),
            i64::try_from(bytes_from_viewer).unwrap_or(i64::MAX),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(computer.id = %grant.computer_id, screen.session.id = %session), err)]
    async fn take_over(
        &self,
        grant: &ScreenGrant,
        session: SessionId,
        driver_name: Option<String>,
        ttl: Duration,
    ) -> Result<TakeOver, PgScreenError> {
        let mut tx = self.pool.begin().await?;
        // The upsert only takes a lease that is free, lapsed or this user's:
        // another user's live lease leaves no row, which is Busy. When no
        // lease row exists yet, two first take-overs race on the insert and
        // the second one's guard sees the first's lease. A driver who hands
        // back between the upsert and the read of who drives leaves the
        // lease free: the upsert runs again. The guard and the new lease
        // read the clock when they run, after any wait on the lease row:
        // `now()` is the transaction's start, so a lease that lapsed while
        // this one waited would still count as live.
        let mut attempts = 0;
        let row = loop {
            attempts += 1;
            let row = sqlx::query_as!(
                LeaseRow,
                r#"
                INSERT INTO computer_screen_driver_leases AS lease
                    (computer_id, harness_id, session_id, user_id, driver_name, agent_user_id, started_at, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6, now(), now() + make_interval(secs => $7))
                ON CONFLICT (computer_id) DO UPDATE SET
                    harness_id = EXCLUDED.harness_id,
                    session_id = EXCLUDED.session_id,
                    user_id = EXCLUDED.user_id,
                    driver_name = EXCLUDED.driver_name,
                    agent_user_id = EXCLUDED.agent_user_id,
                    started_at = CASE
                        WHEN lease.user_id = EXCLUDED.user_id AND lease.expires_at > clock_timestamp() THEN lease.started_at
                        ELSE clock_timestamp()
                    END,
                    expires_at = clock_timestamp() + make_interval(secs => $7)
                WHERE lease.user_id = EXCLUDED.user_id OR lease.expires_at <= clock_timestamp()
                RETURNING computer_id, session_id, user_id, driver_name, agent_user_id, started_at, expires_at
                "#,
                grant.computer_id.as_uuid(),
                grant.harness_id.as_uuid(),
                session.as_uuid(),
                grant.user_id.as_ref(),
                driver_name,
                grant.agent_user_id.as_ref().map(|agent| agent.as_ref()),
                ttl_seconds(ttl),
            )
            .fetch_optional(&mut *tx)
            .await?;
            if let Some(row) = row {
                break row;
            }
            let driver = sqlx::query!(
                "SELECT user_id, driver_name FROM computer_screen_driver_leases WHERE computer_id = $1",
                grant.computer_id.as_uuid(),
            )
            .fetch_optional(&mut *tx)
            .await?;
            match driver {
                Some(driver) => {
                    return Ok(TakeOver::Busy(Driver {
                        user_id: user_id(driver.user_id)?,
                        name: driver.driver_name,
                    }));
                }
                None if attempts < 3 => {}
                None => return Err(PgScreenError::Contended),
            }
        };
        // The same user moved the lease to this socket when their open drive
        // started when the lease did: the upsert kept the lease's start. A
        // fresh or lapsed lease starts now, after any drive. (Read after the
        // upsert, so a racing first take-over's drive, committed while this
        // one waited on the lease row, is seen.)
        let open_drive_started = sqlx::query_scalar!(
            r#"
            SELECT started_at FROM computer_screen_drives
            WHERE computer_id = $1 AND user_id = $2 AND ended_at IS NULL
            FOR UPDATE
            "#,
            grant.computer_id.as_uuid(),
            grant.user_id.as_ref(),
        )
        .fetch_optional(&mut *tx)
        .await?;
        let continues = open_drive_started == Some(row.started_at);
        let lease = Lease::try_from(row)?;

        if continues {
            sqlx::query!(
                "UPDATE computer_screen_drives SET session_id = $2 WHERE computer_id = $1 AND ended_at IS NULL",
                grant.computer_id.as_uuid(),
                session.as_uuid(),
            )
            .execute(&mut *tx)
            .await?;
        } else {
            // A lapsed lease overwritten here never got its hand-back.
            sqlx::query!(
                r#"
                UPDATE computer_screen_drives SET ended_at = now(), end_reason = $2
                WHERE computer_id = $1 AND ended_at IS NULL
                "#,
                grant.computer_id.as_uuid(),
                DriveEnd::Lapsed.as_ref(),
            )
            .execute(&mut *tx)
            .await?;
            sqlx::query!(
                r#"
                INSERT INTO computer_screen_drives (id, computer_id, session_id, user_id, started_at)
                VALUES ($1, $2, $3, $4, $5)
                "#,
                Uuid::now_v7(),
                grant.computer_id.as_uuid(),
                session.as_uuid(),
                grant.user_id.as_ref(),
                lease.started_at,
            )
            .execute(&mut *tx)
            .await?;
            insert_notice(
                &mut tx,
                &lease,
                AgentNotice {
                    name: NoticeName::TakeOver,
                    driver_name: lease.driver.name.clone(),
                    started_at: lease.started_at,
                    ended_at: None,
                    note: None,
                },
            )
            .await?;
        }
        notify(&mut tx, lease.computer_id).await?;
        tx.commit().await?;
        Ok(TakeOver::Taken(lease))
    }

    #[tracing::instrument(skip_all, fields(computer.id = %computer, screen.session.id = %session), err)]
    async fn renew(
        &self,
        computer: ComputerId,
        session: SessionId,
        ttl: Duration,
    ) -> Result<Option<Lease>, PgScreenError> {
        // A lapsed lease is not revived: it is released by whoever reads it.
        // The clock is read after any wait on the row, as in `take_over`.
        let row = sqlx::query_as!(
            LeaseRow,
            r#"
            UPDATE computer_screen_driver_leases
            SET expires_at = clock_timestamp() + make_interval(secs => $3)
            WHERE computer_id = $1 AND session_id = $2 AND expires_at > clock_timestamp()
            RETURNING computer_id, session_id, user_id, driver_name, agent_user_id, started_at, expires_at
            "#,
            computer.as_uuid(),
            session.as_uuid(),
            ttl_seconds(ttl),
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(Lease::try_from).transpose()
    }

    #[tracing::instrument(skip_all, fields(computer.id = %computer), err)]
    async fn release(
        &self,
        computer: ComputerId,
        release: Release,
    ) -> Result<Option<Lease>, PgScreenError> {
        let mut tx = self.pool.begin().await?;
        let end = DriveEnd::from(&release);
        let (row, note) = match release {
            Release::HandBack { user_id, note } => {
                let row = sqlx::query_as!(
                    LeaseRow,
                    r#"
                    DELETE FROM computer_screen_driver_leases
                    WHERE computer_id = $1 AND user_id = $2
                    RETURNING computer_id, session_id, user_id, driver_name, agent_user_id, started_at, expires_at
                    "#,
                    computer.as_uuid(),
                    user_id.as_ref(),
                )
                .fetch_optional(&mut *tx)
                .await?;
                (row, note)
            }
            Release::Lapsed => {
                let row = sqlx::query_as!(
                    LeaseRow,
                    r#"
                    DELETE FROM computer_screen_driver_leases
                    WHERE computer_id = $1 AND expires_at <= clock_timestamp()
                    RETURNING computer_id, session_id, user_id, driver_name, agent_user_id, started_at, expires_at
                    "#,
                    computer.as_uuid(),
                )
                .fetch_optional(&mut *tx)
                .await?;
                (row, None)
            }
            Release::Unpaused { started_at } => {
                let row = sqlx::query_as!(
                    LeaseRow,
                    r#"
                    DELETE FROM computer_screen_driver_leases
                    WHERE computer_id = $1 AND started_at = $2
                    RETURNING computer_id, session_id, user_id, driver_name, agent_user_id, started_at, expires_at
                    "#,
                    computer.as_uuid(),
                    started_at,
                )
                .fetch_optional(&mut *tx)
                .await?;
                (row, None)
            }
            Release::Refused { session_id } => {
                let row = sqlx::query_as!(
                    LeaseRow,
                    r#"
                    DELETE FROM computer_screen_driver_leases
                    WHERE computer_id = $1 AND session_id = $2
                    RETURNING computer_id, session_id, user_id, driver_name, agent_user_id, started_at, expires_at
                    "#,
                    computer.as_uuid(),
                    session_id.as_uuid(),
                )
                .fetch_optional(&mut *tx)
                .await?;
                (row, None)
            }
        };
        let Some(row) = row else {
            return Ok(None);
        };
        let lease = Lease::try_from(row)?;
        sqlx::query!(
            r#"
            UPDATE computer_screen_drives SET ended_at = now(), end_reason = $2
            WHERE computer_id = $1 AND ended_at IS NULL
            "#,
            computer.as_uuid(),
            end.as_ref(),
        )
        .execute(&mut *tx)
        .await?;
        if end == DriveEnd::Refused {
            // The agent never paused: it hears of neither end.
            sqlx::query!(
                r#"
                DELETE FROM computer_screen_agent_notices
                WHERE computer_id = $1 AND payload->>'name' = 'computer.screen.takeOver'
                  AND (payload->>'startedAt')::timestamptz = $2
                "#,
                computer.as_uuid(),
                lease.started_at,
            )
            .execute(&mut *tx)
            .await?;
        } else {
            insert_notice(
                &mut tx,
                &lease,
                AgentNotice {
                    name: NoticeName::HandBack,
                    driver_name: lease.driver.name.clone(),
                    started_at: lease.started_at,
                    ended_at: Some(Utc::now()),
                    note,
                },
            )
            .await?;
        }
        notify(&mut tx, computer).await?;
        tx.commit().await?;
        Ok(Some(lease))
    }

    #[tracing::instrument(skip_all, fields(computer.id = %computer), err)]
    async fn lease(&self, computer: ComputerId) -> Result<Option<Lease>, PgScreenError> {
        let row = sqlx::query_as!(
            LeaseRow,
            r#"
            SELECT computer_id, session_id, user_id, driver_name, agent_user_id, started_at, expires_at
            FROM computer_screen_driver_leases
            WHERE computer_id = $1
            "#,
            computer.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(Lease::try_from).transpose()
    }

    #[tracing::instrument(skip_all, err)]
    async fn agent_lease(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<Lease>, PgScreenError> {
        // An agent runs on one computer; the oldest lease decides if a
        // second ever appears.
        let row = sqlx::query_as!(
            LeaseRow,
            r#"
            SELECT computer_id, session_id, user_id, driver_name, agent_user_id, started_at, expires_at
            FROM computer_screen_driver_leases
            WHERE agent_user_id = $1
            ORDER BY started_at
            LIMIT 1
            "#,
            agent.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(Lease::try_from).transpose()
    }

    #[tracing::instrument(skip_all, err)]
    async fn claim_notices(
        &self,
        agent: &MacroUserIdStr<'_>,
        kept: Duration,
        claim_for: Duration,
    ) -> Result<Vec<PendingNotice>, PgScreenError> {
        // SKIP LOCKED: a concurrent claim takes none of the rows this one
        // is taking, rather than waiting to take the same ones.
        let mut rows = sqlx::query!(
            r#"
            UPDATE computer_screen_agent_notices
            SET claimed_until = now() + make_interval(secs => $3)
            WHERE id IN (
                SELECT id FROM computer_screen_agent_notices
                WHERE agent_user_id = $1
                  AND created_at > now() - make_interval(secs => $2)
                  AND (claimed_until IS NULL OR claimed_until <= now())
                ORDER BY created_at, id
                LIMIT 20
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, payload, created_at, claimed_until AS "claimed_until!"
            "#,
            agent.as_ref(),
            ttl_seconds(kept),
            ttl_seconds(claim_for),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.sort_by_key(|row| (row.created_at, row.id));
        rows.into_iter()
            .map(|row| {
                Ok(PendingNotice {
                    claim: NoticeClaim {
                        id: row.id,
                        until: row.claimed_until,
                    },
                    notice: serde_json::from_value(row.payload)?,
                })
            })
            .collect()
    }

    #[tracing::instrument(skip_all, err)]
    async fn lapsed_leases(&self) -> Result<Vec<ComputerId>, PgScreenError> {
        let computers = sqlx::query_scalar!(
            "SELECT computer_id FROM computer_screen_driver_leases WHERE expires_at <= now() LIMIT 500"
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(computers
            .into_iter()
            .map(ComputerId::new_from_uuid)
            .collect())
    }

    #[tracing::instrument(skip_all, err)]
    async fn owed_thaws(&self) -> Result<Vec<OwedThaw>, PgScreenError> {
        let rows = sqlx::query!(
            r#"
            SELECT id, computer_id, started_at, ended_at AS "ended_at!", thaw_failures, thaw_first_failed_at
            FROM computer_screen_drives
            WHERE ended_at IS NOT NULL AND thaw_settled_at IS NULL
            ORDER BY thaw_tried_at NULLS FIRST, ended_at
            LIMIT 500
            "#
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let computer_id = ComputerId::new_from_uuid(row.computer_id);
                OwedThaw {
                    row: row.id,
                    computer_id,
                    drive: DriveId::of(computer_id, row.started_at),
                    ended_at: row.ended_at,
                    failures: u32::try_from(row.thaw_failures).unwrap_or(0),
                    first_failed_at: row.thaw_first_failed_at,
                }
            })
            .collect())
    }

    #[tracing::instrument(skip_all, err)]
    async fn settle_thaw(&self, row: Uuid, settled: ThawSettled) -> Result<(), PgScreenError> {
        sqlx::query!(
            r#"
            UPDATE computer_screen_drives
            SET thaw_settled_at = now(), thaw_settled = $2, thaw_tried_at = now()
            WHERE id = $1 AND thaw_settled_at IS NULL
            "#,
            row,
            settled.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn thaw_tried(&self, row: Uuid, failed: bool) -> Result<(), PgScreenError> {
        sqlx::query!(
            r#"
            UPDATE computer_screen_drives
            SET thaw_tried_at = now(),
                thaw_failures = CASE WHEN $2 THEN thaw_failures + 1 ELSE 0 END,
                thaw_first_failed_at = CASE WHEN $2 THEN coalesce(thaw_first_failed_at, now())
                                            ELSE NULL END
            WHERE id = $1
            "#,
            row,
            failed,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(computer.id = %computer), err)]
    async fn drive_end(
        &self,
        computer: ComputerId,
        started_at: DateTime<Utc>,
    ) -> Result<Option<DriveEnd>, PgScreenError> {
        let reason = sqlx::query_scalar!(
            "SELECT end_reason FROM computer_screen_drives WHERE computer_id = $1 AND started_at = $2",
            computer.as_uuid(),
            started_at,
        )
        .fetch_optional(&self.pool)
        .await?
        .flatten();
        reason
            .map(|reason| {
                reason
                    .parse()
                    .map_err(|_| PgScreenError::Corrupt("drive end reason"))
            })
            .transpose()
    }

    #[tracing::instrument(skip_all, fields(notices = claims.len()), err)]
    async fn unclaim_notices(&self, claims: &[NoticeClaim]) -> Result<(), PgScreenError> {
        // Only the claim given back: a later claim of the same notice, made
        // after this one ran out, has a later `claimed_until` and stays.
        let ids: Vec<Uuid> = claims.iter().map(|claim| claim.id).collect();
        let until: Vec<DateTime<Utc>> = claims.iter().map(|claim| claim.until).collect();
        sqlx::query!(
            r#"
            UPDATE computer_screen_agent_notices notice SET claimed_until = NULL
            FROM unnest($1::uuid[], $2::timestamptz[]) AS claim(id, until)
            WHERE notice.id = claim.id AND notice.claimed_until = claim.until
            "#,
            &ids,
            &until,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(notices = claims.len()), err)]
    async fn delete_notices(&self, claims: &[NoticeClaim]) -> Result<(), PgScreenError> {
        let ids: Vec<Uuid> = claims.iter().map(|claim| claim.id).collect();
        sqlx::query!(
            "DELETE FROM computer_screen_agent_notices WHERE id = ANY($1)",
            &ids,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(computer.id = %computer), err)]
    async fn open_sockets(
        &self,
        computer: ComputerId,
        user: &MacroUserIdStr<'_>,
        fresh: Duration,
    ) -> Result<(u32, u32), PgScreenError> {
        let counts = sqlx::query!(
            r#"
            SELECT count(*) FILTER (WHERE user_id = $2) AS "theirs!",
                   count(*) AS "everyone!"
            FROM computer_screen_sessions
            WHERE computer_id = $1
              AND ended_at IS NULL
              AND seen_at > now() - make_interval(secs => $3)
            "#,
            computer.as_uuid(),
            user.as_ref(),
            ttl_seconds(fresh),
        )
        .fetch_one(&self.pool)
        .await?;
        Ok((
            u32::try_from(counts.theirs).unwrap_or(u32::MAX),
            u32::try_from(counts.everyone).unwrap_or(u32::MAX),
        ))
    }
}

/// Record `notice` for the lease's agent, if the computer runs one.
async fn insert_notice(
    tx: &mut Transaction<'_, Postgres>,
    lease: &Lease,
    notice: AgentNotice,
) -> Result<(), PgScreenError> {
    let Some(agent) = &lease.agent_user_id else {
        return Ok(());
    };
    sqlx::query!(
        r#"
        INSERT INTO computer_screen_agent_notices (id, computer_id, agent_user_id, payload)
        VALUES ($1, $2, $3, $4)
        "#,
        Uuid::now_v7(),
        lease.computer_id.as_uuid(),
        agent.as_ref(),
        serde_json::to_value(&notice)?,
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Tell every replica `computer`'s lease changed, once `tx` commits.
async fn notify(
    tx: &mut Transaction<'_, Postgres>,
    computer: ComputerId,
) -> Result<(), PgScreenError> {
    sqlx::query_scalar!(
        r#"SELECT 1 AS "sent!" FROM pg_notify($1, $2)"#,
        LEASE_CHANGED_CHANNEL,
        computer.to_string(),
    )
    .fetch_one(&mut **tx)
    .await?;
    Ok(())
}
