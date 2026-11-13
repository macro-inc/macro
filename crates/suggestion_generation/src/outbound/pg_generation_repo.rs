//! PostgreSQL store for generations, their sessions and the nightly
//! audience. It also answers the suggestions and routine suggestions crates'
//! questions about a generation session and a person's latest generation.
//!
//! Status writes addressed by id take their guards from the domain's tables
//! ([`GenerationEvent::sources`], [`CleanupEvent::sources`]). Scans spell
//! their states out, so the partial indexes on `status = 'generating'` and
//! `cleanup IN ('open', 'stopping')` serve them under a generic plan; the
//! tests check every spelled-out state against the tables.

use bot_id::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use scheduled_action::domain::suggestions::model::GenerationStatus as RoutineGenerationStatus;
use scheduled_action::domain::suggestions::ports::GenerationStatuses;
use sqlx::PgPool;
use strum::IntoEnumIterator as _;
use suggestions::domain::model::{GenerationSession, GenerationTrigger, SessionKind};
use suggestions::domain::ports::GenerationSessions;

use crate::domain::generation::{GenerationEvent, GenerationStatus, OverviewFacts, PastRun};
use crate::domain::model::{
    AdmissionFacts, AudienceMember, LostGeneration, NewGeneration, StaleSession,
};
use crate::domain::nightly::NightlyOutcome;
use crate::domain::ports::GenerationRepo;
use crate::domain::session::{Cleanup, CleanupEvent, SessionEnding};

#[cfg(test)]
mod test;

/// Why reading or writing generations failed.
#[derive(Debug, thiserror::Error)]
pub enum PgGenerationRepoError {
    /// The database failed.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    /// A stored row holds a value the domain doesn't know.
    #[error("undecodable generation row: {0}")]
    Decode(&'static str),
}

/// [`GenerationRepo`] on MacroDB.
#[derive(Clone)]
pub struct PgGenerationRepo {
    pool: PgPool,
}

impl PgGenerationRepo {
    /// Generations in `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn user(id: String) -> Result<MacroUserIdStr<'static>, PgGenerationRepoError> {
    MacroUserIdStr::try_from(id).map_err(|_| PgGenerationRepoError::Decode("a user id"))
}

fn agent(id: &str) -> Result<BotId, PgGenerationRepoError> {
    id.parse()
        .map(BotId::new_from_uuid)
        .map_err(|_| PgGenerationRepoError::Decode("an agent id"))
}

fn parse<T: std::str::FromStr>(
    value: &str,
    what: &'static str,
) -> Result<T, PgGenerationRepoError> {
    value.parse().map_err(|_| PgGenerationRepoError::Decode(what))
}

fn attempts(value: i16) -> Result<u8, PgGenerationRepoError> {
    u8::try_from(value).map_err(|_| PgGenerationRepoError::Decode("an attempt count"))
}

/// The stored names of `states`.
fn names<T: AsRef<str>>(states: &[T]) -> Vec<String> {
    states
        .iter()
        .map(|state| state.as_ref().to_owned())
        .collect()
}

/// The cleanup states `keep` holds for, by stored name.
fn cleanup_states(keep: fn(Cleanup) -> bool) -> Vec<String> {
    names(&Cleanup::iter().filter(|state| keep(*state)).collect::<Vec<_>>())
}

fn past_run(
    status: Option<String>,
    attempt: Option<i16>,
    started_at: Option<DateTime<Utc>>,
) -> Result<Option<PastRun>, PgGenerationRepoError> {
    let (Some(status), Some(attempt), Some(started_at)) = (status, attempt, started_at) else {
        return Ok(None);
    };
    Ok(Some(PastRun {
        status: parse(&status, "a generation status")?,
        attempt: attempts(attempt)?,
        started_at,
    }))
}

impl GenerationRepo for PgGenerationRepo {
    type Err = PgGenerationRepoError;

    async fn admission(
        &self,
        user: &MacroUserIdStr<'_>,
        trigger: GenerationTrigger,
    ) -> Result<AdmissionFacts, Self::Err> {
        let row = sqlx::query!(
            r#"SELECT EXISTS (
                       SELECT 1 FROM suggestion_generation
                       WHERE user_id = $1 AND status = 'generating') AS "running!",
                   latest.status AS "status?",
                   latest.attempt AS "attempt?",
                   latest.started_at AS "started_at?"
               FROM (SELECT 1) AS one
               LEFT JOIN LATERAL (
                   SELECT status, attempt, started_at FROM suggestion_generation
                   WHERE user_id = $1 AND trigger = $2
                   ORDER BY started_at DESC
                   LIMIT 1) AS latest ON true"#,
            user.as_ref(),
            trigger.as_ref(),
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(AdmissionFacts {
            running: row.running,
            latest: past_run(row.status, row.attempt, row.started_at)?,
        })
    }

    async fn insert(&self, generation: &NewGeneration) -> Result<bool, Self::Err> {
        // The unique indexes refuse a second running generation and a
        // second onboarding one of the same attempt; the guard refuses one
        // started since admission read.
        let inserted = sqlx::query!(
            r#"INSERT INTO suggestion_generation
                 (id, user_id, trigger, status, attempt, started_at, heartbeat_at)
               SELECT $1, $2, $3, $4, $5, $6, $6
               WHERE NOT EXISTS (
                   SELECT 1 FROM suggestion_generation
                   WHERE user_id = $2 AND trigger = $3
                     AND ($7::timestamptz IS NULL OR started_at > $7))
               ON CONFLICT DO NOTHING"#,
            generation.id,
            generation.user.as_ref(),
            generation.trigger.as_ref(),
            GenerationStatus::Generating.as_ref(),
            i16::from(generation.attempt),
            generation.started_at,
            generation.after,
        )
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(inserted == 1)
    }

    async fn end(
        &self,
        generation: Uuid,
        event: GenerationEvent,
        now: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let sources = names(&event.sources());
        let ended = sqlx::query!(
            r#"UPDATE suggestion_generation SET status = $2, finished_at = $3
               WHERE id = $1 AND status = ANY($4)"#,
            generation,
            <&str>::from(event.entered()),
            now,
            &sources[..],
        )
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(ended == 1)
    }

    async fn beat(&self, generation: Uuid, now: DateTime<Utc>) -> Result<bool, Self::Err> {
        let beaten = sqlx::query!(
            r#"UPDATE suggestion_generation SET heartbeat_at = $2
               WHERE id = $1 AND status = $3"#,
            generation,
            now,
            GenerationStatus::Generating.as_ref(),
        )
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(beaten == 1)
    }

    async fn interrupt_lost(
        &self,
        before: DateTime<Utc>,
        now: DateTime<Utc>,
        limit: u16,
    ) -> Result<Vec<LostGeneration>, Self::Err> {
        // GenerationEvent::HeartbeatLost: generating → interrupted.
        let rows = sqlx::query!(
            r#"UPDATE suggestion_generation SET status = 'interrupted', finished_at = $2
               WHERE id IN (
                   SELECT id FROM suggestion_generation
                   WHERE status = 'generating' AND heartbeat_at < $1
                   ORDER BY heartbeat_at
                   LIMIT $3
                   FOR UPDATE SKIP LOCKED)
                 AND status = 'generating'
               RETURNING id, user_id, trigger"#,
            before,
            now,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(LostGeneration {
                    generation: row.id,
                    user: user(row.user_id)?,
                    trigger: parse(&row.trigger, "a generation trigger")?,
                })
            })
            .collect()
    }

    async fn open_session(
        &self,
        session: Uuid,
        generation: Uuid,
        user: &MacroUserIdStr<'_>,
        agent: BotId,
        kind: SessionKind,
        surfaces: &[String],
        now: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"INSERT INTO suggestion_generation_session
                 (session_id, generation_id, user_id, agent_id, kind, surfaces, opened_at, cleanup)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
            session,
            generation,
            user.as_ref(),
            agent.as_uuid().to_string(),
            kind.as_ref(),
            surfaces,
            now,
            Cleanup::Open.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn end_session(
        &self,
        session: Uuid,
        ending: SessionEnding,
        now: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let event = CleanupEvent::Ended;
        let sources = names(&event.sources());
        let ended = sqlx::query!(
            r#"UPDATE suggestion_generation_session
               SET cleanup = $2, ending = $3, ended_at = $4, cleanup_at = $4
               WHERE session_id = $1 AND cleanup = ANY($5)"#,
            session,
            <&str>::from(event.entered()),
            ending.as_ref(),
            now,
            &sources[..],
        )
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(ended == 1)
    }

    async fn advance_cleanup(
        &self,
        session: Uuid,
        event: CleanupEvent,
        now: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        // An end carries its ending: that is `end_session`.
        if event == CleanupEvent::Ended {
            return Ok(false);
        }
        let sources = names(&event.sources());
        let moved = sqlx::query!(
            r#"UPDATE suggestion_generation_session
               SET cleanup = $2, cleanup_at = $3, cleanup_attempts = cleanup_attempts + $4
               WHERE session_id = $1 AND cleanup = ANY($5)"#,
            session,
            <&str>::from(event.entered()),
            now,
            i16::from(event.counts_attempt()),
            &sources[..],
        )
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(moved == 1)
    }

    async fn end_orphaned_sessions(
        &self,
        stale_before: DateTime<Utc>,
        now: DateTime<Utc>,
        limit: u16,
    ) -> Result<Vec<StaleSession>, Self::Err> {
        // CleanupEvent::Ended: open → stopping, ending interrupted.
        let rows = sqlx::query!(
            r#"UPDATE suggestion_generation_session AS s
               SET cleanup = 'stopping', ending = 'interrupted', ended_at = $2, cleanup_at = $2
               WHERE s.session_id IN (
                   SELECT o.session_id FROM suggestion_generation_session AS o
                   JOIN suggestion_generation AS g ON g.id = o.generation_id
                   WHERE o.cleanup = 'open' AND (g.status <> 'generating' OR o.opened_at < $1)
                   ORDER BY o.opened_at
                   LIMIT $3
                   FOR UPDATE OF o SKIP LOCKED)
                 AND s.cleanup = 'open'
               RETURNING s.session_id, s.user_id, s.agent_id, s.cleanup_attempts"#,
            stale_before,
            now,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(StaleSession {
                    session: row.session_id,
                    user: user(row.user_id)?,
                    agent: agent(&row.agent_id)?,
                    ending: SessionEnding::Interrupted,
                    attempts: attempts(row.cleanup_attempts)?,
                })
            })
            .collect()
    }

    async fn claim_stuck_sessions(
        &self,
        before: DateTime<Utc>,
        now: DateTime<Utc>,
        limit: u16,
    ) -> Result<Vec<StaleSession>, Self::Err> {
        let rows = sqlx::query!(
            r#"UPDATE suggestion_generation_session AS s SET cleanup_at = $2
               WHERE s.session_id IN (
                   SELECT session_id FROM suggestion_generation_session
                   WHERE cleanup = 'stopping' AND cleanup_at < $1
                   ORDER BY cleanup_at
                   LIMIT $3
                   FOR UPDATE SKIP LOCKED)
                 AND s.cleanup = 'stopping'
               RETURNING s.session_id, s.user_id, s.agent_id, s.ending, s.cleanup_attempts"#,
            before,
            now,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let ending = row
                    .ending
                    .ok_or(PgGenerationRepoError::Decode("an ended session's ending"))?;
                Ok(StaleSession {
                    session: row.session_id,
                    user: user(row.user_id)?,
                    agent: agent(&row.agent_id)?,
                    ending: parse(&ending, "a session ending")?,
                    attempts: attempts(row.cleanup_attempts)?,
                })
            })
            .collect()
    }

    async fn last_routines_ok(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Option<DateTime<Utc>>, Self::Err> {
        let at = sqlx::query_scalar!(
            "SELECT last_routines_ok_at FROM suggestion_audience WHERE user_id = $1",
            user.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(at.flatten())
    }

    async fn routines_ok(
        &self,
        user: &MacroUserIdStr<'_>,
        timezone: &str,
        now: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        // Someone not in the rotation gets a row outside it (no next run):
        // a free plan, or never seen with suggestions on.
        sqlx::query!(
            r#"INSERT INTO suggestion_audience (user_id, timezone, seen_at, last_routines_ok_at)
               VALUES ($1, $2, $3, $3)
               ON CONFLICT (user_id) DO UPDATE
                   SET last_routines_ok_at = EXCLUDED.last_routines_ok_at"#,
            user.as_ref(),
            timezone,
            now,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn record_nightly(
        &self,
        user: &MacroUserIdStr<'_>,
        outcome: NightlyOutcome,
        next_run: Option<DateTime<Utc>>,
        now: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"UPDATE suggestion_audience
               SET next_run_at = $2, last_outcome = $3, last_outcome_at = $4
               WHERE user_id = $1"#,
            user.as_ref(),
            next_run,
            outcome.as_ref(),
            now,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn see(
        &self,
        user: &MacroUserIdStr<'_>,
        timezone: &str,
        now: DateTime<Utc>,
        next_run: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        // A run already set for the same zone stands; one out of the
        // rotation comes back in.
        sqlx::query!(
            r#"INSERT INTO suggestion_audience (user_id, timezone, seen_at, next_run_at)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (user_id) DO UPDATE SET
                   seen_at = EXCLUDED.seen_at,
                   timezone = EXCLUDED.timezone,
                   next_run_at = CASE WHEN suggestion_audience.timezone = EXCLUDED.timezone
                                           AND suggestion_audience.next_run_at IS NOT NULL
                                      THEN suggestion_audience.next_run_at
                                      ELSE EXCLUDED.next_run_at END"#,
            user.as_ref(),
            timezone,
            now,
            next_run,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn account(&self, user: &MacroUserIdStr<'_>) -> Result<Option<Uuid>, Self::Err> {
        let account = sqlx::query_scalar!(
            r#"SELECT macro_user_id AS "macro_user_id?" FROM "User" WHERE id = $1"#,
            user.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(account.flatten())
    }

    async fn prune_changes(&self, before: DateTime<Utc>, limit: u16) -> Result<u64, Self::Err> {
        // Entries' ids are UUIDv7, ordered by when they were written: the
        // primary key finds the old ones.
        let deleted = sqlx::query!(
            r#"DELETE FROM suggestion_change
               WHERE id IN (SELECT id FROM suggestion_change WHERE id < $1 ORDER BY id LIMIT $2)"#,
            uuid_v7_floor(before),
            i64::from(limit),
        )
        .execute(&self.pool)
        .await?;
        Ok(deleted.rows_affected())
    }

    async fn traced(&self, generation: Uuid, trace_id: &str) -> Result<(), Self::Err> {
        sqlx::query!(
            "UPDATE suggestion_generation SET trace_id = $2 WHERE id = $1",
            generation,
            trace_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn due(&self, now: DateTime<Utc>, limit: u16) -> Result<Vec<AudienceMember>, Self::Err> {
        let mut tx = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *tx)
            .await?;
        // Out of the rotation (no next run) is never due.
        let rows = sqlx::query!(
            r#"SELECT a.user_id, a.timezone, a.seen_at FROM suggestion_audience AS a
               WHERE a.next_run_at <= $1
                 AND NOT EXISTS (
                     SELECT 1 FROM suggestion_generation AS g
                     WHERE g.user_id = a.user_id AND g.status = 'generating')
               ORDER BY a.next_run_at
               LIMIT $2"#,
            now,
            i64::from(limit),
        )
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        rows.into_iter()
            .map(|row| {
                Ok(AudienceMember {
                    user: user(row.user_id)?,
                    timezone: parse(&row.timezone, "a time zone")?,
                    seen_at: row.seen_at,
                })
            })
            .collect()
    }

    async fn overview(&self, user: &MacroUserIdStr<'_>) -> Result<OverviewFacts, Self::Err> {
        let row = sqlx::query!(
            r#"SELECT running.trigger AS "running_trigger?",
                   running.started_at AS "running_started_at?",
                   ended.status AS "ended_status?",
                   ended.finished_at AS "ended_at?",
                   manual.status AS "manual_status?",
                   manual.attempt AS "manual_attempt?",
                   manual.started_at AS "manual_started_at?"
               FROM (SELECT 1) AS one
               LEFT JOIN LATERAL (
                   SELECT trigger, started_at FROM suggestion_generation
                   WHERE user_id = $1 AND status = 'generating'
                   LIMIT 1) AS running ON true
               LEFT JOIN LATERAL (
                   SELECT status, finished_at FROM suggestion_generation
                   WHERE user_id = $1 AND status <> 'generating'
                   ORDER BY started_at DESC
                   LIMIT 1) AS ended ON true
               LEFT JOIN LATERAL (
                   SELECT status, attempt, started_at FROM suggestion_generation
                   WHERE user_id = $1 AND trigger = $2
                   ORDER BY started_at DESC
                   LIMIT 1) AS manual ON true"#,
            user.as_ref(),
            GenerationTrigger::Manual.as_ref(),
        )
        .fetch_one(&self.pool)
        .await?;
        let running = match (row.running_trigger, row.running_started_at) {
            (Some(trigger), Some(started_at)) => {
                Some((parse(&trigger, "a generation trigger")?, started_at))
            }
            _ => None,
        };
        let last_ended = match (row.ended_status, row.ended_at) {
            (Some(status), Some(at)) => Some((parse(&status, "a generation status")?, at)),
            _ => None,
        };
        Ok(OverviewFacts {
            running,
            last_ended,
            latest_manual: past_run(
                row.manual_status,
                row.manual_attempt,
                row.manual_started_at,
            )?,
        })
    }
}

#[async_trait::async_trait]
impl GenerationSessions for PgGenerationRepo {
    async fn open_session(
        &self,
        session: Uuid,
    ) -> Result<Option<GenerationSession>, rootcause::Report> {
        let states = cleanup_states(Cleanup::takes_tools);
        let row = sqlx::query!(
            r#"SELECT s.session_id, s.generation_id, s.user_id, s.kind, s.surfaces, g.trace_id
               FROM suggestion_generation_session AS s
               JOIN suggestion_generation AS g ON g.id = s.generation_id
               WHERE s.session_id = $1 AND s.cleanup = ANY($2)"#,
            session,
            &states[..],
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| rootcause::Report::new(error).into_dynamic())?;
        row.map(|row| {
            Ok(GenerationSession {
                session: row.session_id,
                generation: row.generation_id,
                user: user(row.user_id)
                    .map_err(|error| rootcause::Report::new(error).into_dynamic())?,
                kind: row
                    .kind
                    .parse()
                    .map_err(|error| rootcause::Report::new(error).into_dynamic())?,
                surfaces: row.surfaces,
                trace_id: row.trace_id,
            })
        })
        .transpose()
    }

    async fn undeleted(&self, session: Uuid) -> Result<bool, rootcause::Report> {
        let states = cleanup_states(Cleanup::undeleted);
        sqlx::query_scalar!(
            r#"SELECT EXISTS (
                   SELECT 1 FROM suggestion_generation_session
                   WHERE session_id = $1 AND cleanup = ANY($2)) AS "undeleted!""#,
            session,
            &states[..],
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|error| rootcause::Report::new(error).into_dynamic())
    }
}

/// How routine suggestions read a generation's status: one that ended part
/// way reads as ready, one cut short as failed.
fn routine_status(status: GenerationStatus) -> RoutineGenerationStatus {
    match status {
        GenerationStatus::Generating => RoutineGenerationStatus::Generating,
        GenerationStatus::Ready | GenerationStatus::Partial => RoutineGenerationStatus::Ready,
        GenerationStatus::Failed | GenerationStatus::Cancelled | GenerationStatus::Interrupted => {
            RoutineGenerationStatus::Failed
        }
    }
}

#[async_trait::async_trait]
impl GenerationStatuses for PgGenerationRepo {
    async fn latest(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> anyhow::Result<Option<RoutineGenerationStatus>> {
        // A generation whose process died is marked interrupted by the
        // sweep within minutes: no reader infers it.
        let status = sqlx::query_scalar!(
            r#"SELECT status FROM suggestion_generation WHERE user_id = $1
               ORDER BY started_at DESC, id DESC LIMIT 1"#,
            user.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        status
            .map(|status| Ok(routine_status(status.parse::<GenerationStatus>()?)))
            .transpose()
    }
}

/// The smallest UUIDv7 written at `at`: every v7 id written before it sorts
/// below it.
fn uuid_v7_floor(at: DateTime<Utc>) -> Uuid {
    let millis = u64::try_from(at.timestamp_millis()).unwrap_or(0);
    let mut bytes = [0_u8; 16];
    bytes[..6].copy_from_slice(&millis.to_be_bytes()[2..]);
    bytes[6] = 0x70;
    bytes[8] = 0x80;
    Uuid::from_bytes(bytes)
}
