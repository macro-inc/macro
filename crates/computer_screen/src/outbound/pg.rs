//! [`ScreenRepo`] over MacroDB's `computer_screen_*` tables.

use std::time::Duration;

use chrono::{DateTime, Utc};
use computer_id::ComputerId;
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::domain::models::{
    AgentNotice, Driver, EndReason, Lease, NoticeName, PendingNotice, RedeemedTicket, Release,
    ScreenGrant, SessionId, TakeOver,
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
    async fn touch_session(&self, id: SessionId) -> Result<(), PgScreenError> {
        sqlx::query!(
            r#"
            UPDATE computer_screen_sessions SET seen_at = now()
            WHERE id = $1 AND ended_at IS NULL
            "#,
            id.as_uuid(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
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
        // the second one's guard sees the first's lease.
        let row = sqlx::query!(
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
                    WHEN lease.user_id = EXCLUDED.user_id AND lease.expires_at > now() THEN lease.started_at
                    ELSE now()
                END,
                expires_at = EXCLUDED.expires_at
            WHERE lease.user_id = EXCLUDED.user_id OR lease.expires_at <= now()
            RETURNING computer_id, session_id, user_id, driver_name, agent_user_id, started_at, expires_at,
                      xmax::text <> '0' AND started_at <> now() AS "continues!"
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
        let Some(row) = row else {
            let driver = sqlx::query!(
                "SELECT user_id, driver_name FROM computer_screen_driver_leases WHERE computer_id = $1",
                grant.computer_id.as_uuid(),
            )
            .fetch_one(&mut *tx)
            .await?;
            return Ok(TakeOver::Busy(Driver {
                user_id: user_id(driver.user_id)?,
                name: driver.driver_name,
            }));
        };
        // The same user moved the lease to this socket and kept its start:
        // an update (xmax set) that left started_at at another transaction's
        // time. A fresh insert or a lapsed lease's start is this one's now().
        let continues = row.continues;
        let row = LeaseRow {
            computer_id: row.computer_id,
            session_id: row.session_id,
            user_id: row.user_id,
            driver_name: row.driver_name,
            agent_user_id: row.agent_user_id,
            started_at: row.started_at,
            expires_at: row.expires_at,
        };
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
                UPDATE computer_screen_drives SET ended_at = now(), end_reason = 'lapsed'
                WHERE computer_id = $1 AND ended_at IS NULL
                "#,
                grant.computer_id.as_uuid(),
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
        let row = sqlx::query_as!(
            LeaseRow,
            r#"
            UPDATE computer_screen_driver_leases
            SET expires_at = now() + make_interval(secs => $3)
            WHERE computer_id = $1 AND session_id = $2 AND expires_at > now()
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
        let hand_back = matches!(release, Release::HandBack { .. });
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
                    WHERE computer_id = $1 AND expires_at <= now()
                    RETURNING computer_id, session_id, user_id, driver_name, agent_user_id, started_at, expires_at
                    "#,
                    computer.as_uuid(),
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
            if hand_back { "handBack" } else { "lapsed" },
        )
        .execute(&mut *tx)
        .await?;
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
    async fn pending_notices(
        &self,
        agent: &MacroUserIdStr<'_>,
        kept: Duration,
    ) -> Result<Vec<PendingNotice>, PgScreenError> {
        let rows = sqlx::query!(
            r#"
            SELECT id, payload FROM computer_screen_agent_notices
            WHERE agent_user_id = $1 AND created_at > now() - make_interval(secs => $2)
            ORDER BY created_at, id
            LIMIT 20
            "#,
            agent.as_ref(),
            ttl_seconds(kept),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(PendingNotice {
                    id: row.id,
                    notice: serde_json::from_value(row.payload)?,
                })
            })
            .collect()
    }

    #[tracing::instrument(skip_all, fields(notices = ids.len()), err)]
    async fn delete_notices(&self, ids: &[Uuid]) -> Result<(), PgScreenError> {
        sqlx::query!(
            "DELETE FROM computer_screen_agent_notices WHERE id = ANY($1)",
            ids,
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
