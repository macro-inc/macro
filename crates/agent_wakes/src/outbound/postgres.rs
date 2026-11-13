//! `agent_wakes` in MacroDB.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{PgPool, types::Json};

use crate::domain::models::{
    AgentRelation, StoredWake, ValidWake, WakeCursor, WakeFilter, WakePage,
};
use crate::domain::ports::{UpsertOutcome, WakeRepository};
use crate::domain::record::{WakePhase, WakeRecord};

/// Postgres-backed [`WakeRepository`].
#[derive(Clone)]
pub struct PgWakeRepository {
    pool: PgPool,
}

impl PgWakeRepository {
    /// Store wakes through `pool`.
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn phase_rank(phase: WakePhase) -> i16 {
    match phase {
        WakePhase::Start => 0,
        WakePhase::Session => 1,
        WakePhase::End => 2,
    }
}

struct WakeRow {
    record: Json<WakeRecord>,
    received_at: DateTime<Utc>,
    trace_updated_at: Option<DateTime<Utc>>,
    started_at: DateTime<Utc>,
    wake_id: String,
}

impl From<WakeRow> for StoredWake {
    fn from(row: WakeRow) -> Self {
        Self {
            record: row.record.0,
            received_at: row.received_at,
            trace_updated_at: row.trace_updated_at,
        }
    }
}

/// Turn `limit + 1` rows into a page and the cursor after it.
fn page(mut rows: Vec<WakeRow>, limit: u32) -> WakePage {
    let limit = limit as usize;
    let more = rows.len() > limit;
    rows.truncate(limit);

    let next = if more {
        rows.last().map(|row| WakeCursor {
            started_at: row.started_at,
            wake_id: row.wake_id.clone(),
        })
    } else {
        None
    };

    WakePage {
        wakes: rows.into_iter().map(StoredWake::from).collect(),
        next,
    }
}

impl WakeRepository for PgWakeRepository {
    #[tracing::instrument(name = "agent_wakes.db.relation", skip_all, err)]
    async fn relation(
        &self,
        caller: &MacroUserIdStr<'static>,
        agent: &MacroUserIdStr<'static>,
    ) -> Result<AgentRelation, rootcause::Report> {
        let row = sqlx::query!(
            r#"
            SELECT
                u."isAgent" AS "is_agent!",
                EXISTS (
                    SELECT 1
                    FROM team_user agent_team
                    JOIN team_user caller_team
                      ON caller_team.team_id = agent_team.team_id
                     AND caller_team.user_id = $1
                     AND caller_team.team_role IN ('admin'::team_role, 'owner'::team_role)
                    WHERE agent_team.user_id = $2
                ) AS "administers!"
            FROM "User" u
            WHERE u.id = $2
            "#,
            caller.as_ref(),
            agent.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| rootcause::report!("read agent relation: {error}"))?;

        Ok(row.map_or(
            AgentRelation {
                is_agent_account: false,
                caller_administers_agent_team: false,
            },
            |row| AgentRelation {
                is_agent_account: row.is_agent,
                caller_administers_agent_team: row.administers,
            },
        ))
    }

    #[tracing::instrument(name = "agent_wakes.db.upsert", skip_all, err)]
    async fn upsert(
        &self,
        agent: &MacroUserIdStr<'static>,
        wake: &ValidWake,
    ) -> Result<UpsertOutcome, rootcause::Report> {
        // One statement: replace the stored record unless it is of a later
        // phase or another system's. The outer SELECT reads the snapshot from
        // before the write, so `existing_system` is the system stored before.
        let row = sqlx::query!(
            r#"
            WITH upserted AS (
                INSERT INTO agent_wakes
                    (agent_user_id, wake_id, system, phase, status, started_at, record)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (agent_user_id, wake_id) DO UPDATE SET
                    phase = EXCLUDED.phase,
                    status = EXCLUDED.status,
                    started_at = EXCLUDED.started_at,
                    record = EXCLUDED.record,
                    received_at = now()
                WHERE agent_wakes.system = EXCLUDED.system
                  AND agent_wakes.phase <= EXCLUDED.phase
                RETURNING 1 AS stored
            )
            SELECT
                EXISTS (SELECT 1 FROM upserted) AS "stored!",
                (
                    SELECT system FROM agent_wakes
                    WHERE agent_user_id = $1 AND wake_id = $2
                ) AS existing_system
            "#,
            agent.as_ref(),
            wake.record.wake,
            wake.record.system,
            phase_rank(wake.phase),
            wake.status.as_ref(),
            wake.started_at,
            Json(&wake.record) as _,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|error| rootcause::report!("upsert wake: {error}"))?;

        if row.stored {
            return Ok(UpsertOutcome::Stored);
        }

        match row.existing_system {
            Some(system) if system != wake.record.system => Ok(UpsertOutcome::OtherSystem),
            _ => Ok(UpsertOutcome::Stale),
        }
    }

    #[tracing::instrument(name = "agent_wakes.db.list", skip_all, err, fields(limit = limit))]
    async fn list(
        &self,
        agent: &MacroUserIdStr<'static>,
        filter: &WakeFilter,
        after: Option<&WakeCursor>,
        limit: u32,
    ) -> Result<WakePage, rootcause::Report> {
        let after_started = after.map(|cursor| cursor.started_at);
        let after_wake = after.map(|cursor| cursor.wake_id.as_str());
        let fetch = i64::from(limit) + 1;

        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| rootcause::report!("begin list wakes: {error}"))?;
        // A page walks one agent's index range to its limit; this bounds it
        // should the database be slow.
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await
            .map_err(|error| rootcause::report!("set list wakes timeout: {error}"))?;

        // Two queries, so the status filter is an index condition on its own
        // index rather than an `OR` the generic plan can't use.
        let rows = match filter.status {
            Some(status) => {
                sqlx::query_as!(
                    WakeRow,
                    r#"
                    SELECT
                        record AS "record: Json<WakeRecord>",
                        received_at,
                        trace_updated_at,
                        started_at,
                        wake_id
                    FROM agent_wakes
                    WHERE agent_user_id = $1
                      AND status = $2
                      AND (started_at, wake_id)
                          < (COALESCE($3::timestamptz, 'infinity'), COALESCE($4::text, ''))
                    ORDER BY started_at DESC, wake_id DESC
                    LIMIT $5
                    "#,
                    agent.as_ref(),
                    status.as_ref(),
                    after_started,
                    after_wake,
                    fetch,
                )
                .fetch_all(&mut *transaction)
                .await
            }
            None => {
                sqlx::query_as!(
                    WakeRow,
                    r#"
                    SELECT
                        record AS "record: Json<WakeRecord>",
                        received_at,
                        trace_updated_at,
                        started_at,
                        wake_id
                    FROM agent_wakes
                    WHERE agent_user_id = $1
                      AND (started_at, wake_id)
                          < (COALESCE($2::timestamptz, 'infinity'), COALESCE($3::text, ''))
                    ORDER BY started_at DESC, wake_id DESC
                    LIMIT $4
                    "#,
                    agent.as_ref(),
                    after_started,
                    after_wake,
                    fetch,
                )
                .fetch_all(&mut *transaction)
                .await
            }
        }
        .map_err(|error| rootcause::report!("list wakes: {error}"))?;

        transaction
            .commit()
            .await
            .map_err(|error| rootcause::report!("commit list wakes: {error}"))?;
        Ok(page(rows, limit))
    }

    #[tracing::instrument(name = "agent_wakes.db.get", skip_all, err)]
    async fn get(
        &self,
        agent: &MacroUserIdStr<'static>,
        wake_id: &str,
    ) -> Result<Option<StoredWake>, rootcause::Report> {
        let row = sqlx::query_as!(
            WakeRow,
            r#"
            SELECT
                record AS "record: Json<WakeRecord>",
                received_at,
                trace_updated_at,
                started_at,
                wake_id
            FROM agent_wakes
            WHERE agent_user_id = $1 AND wake_id = $2
            "#,
            agent.as_ref(),
            wake_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| rootcause::report!("get wake: {error}"))?;

        Ok(row.map(StoredWake::from))
    }

    #[tracing::instrument(name = "agent_wakes.db.mark_trace", skip_all, err)]
    async fn mark_trace(
        &self,
        agent: &MacroUserIdStr<'static>,
        wake_id: &str,
        at: DateTime<Utc>,
    ) -> Result<bool, rootcause::Report> {
        let result = sqlx::query!(
            r#"
            UPDATE agent_wakes
            SET trace_updated_at = $3
            WHERE agent_user_id = $1 AND wake_id = $2
            "#,
            agent.as_ref(),
            wake_id,
            at,
        )
        .execute(&self.pool)
        .await
        .map_err(|error| rootcause::report!("mark wake trace: {error}"))?;

        Ok(result.rows_affected() == 1)
    }
}
