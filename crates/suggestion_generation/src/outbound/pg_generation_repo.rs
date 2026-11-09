//! PostgreSQL store for generations, their sessions and the nightly
//! audience. It also answers the ideas and routine suggestions crates'
//! questions about a generation session and a person's latest generation.

use bot_id::BotId;
use chrono::{DateTime, Utc};
use ideas::domain::model::{GenerationSession, GenerationTrigger, SessionKind};
use ideas::domain::ports::{GenerationSessions, SuggestionAudience};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use scheduled_action::domain::suggestions::model::GenerationStatus;
use scheduled_action::domain::suggestions::ports::GenerationStatuses;
use sqlx::PgPool;

use crate::domain::model::{AudienceMember, StaleSession};
use crate::domain::ports::GenerationRepo;

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
    Decode(String),
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
    MacroUserIdStr::try_from(id).map_err(|_| PgGenerationRepoError::Decode("a user id".to_owned()))
}

impl GenerationRepo for PgGenerationRepo {
    type Err = PgGenerationRepoError;

    async fn begin(
        &self,
        user: &MacroUserIdStr<'_>,
        trigger: GenerationTrigger,
        now: DateTime<Utc>,
        stale_before: DateTime<Utc>,
        nightly_since: DateTime<Utc>,
    ) -> Result<Option<Uuid>, Self::Err> {
        let mut tx = self.pool.begin().await?;
        // An interrupted run of the same trigger starts again in place.
        let restarted = sqlx::query_scalar!(
            r#"UPDATE suggestion_generation SET started_at = $3
               WHERE user_id = $1 AND trigger = $2 AND status = 'generating' AND started_at < $4
               RETURNING id"#,
            user.as_ref(),
            trigger.as_ref(),
            now,
            stale_before,
        )
        .fetch_optional(&mut *tx)
        .await?;
        if restarted.is_some() {
            tx.commit().await?;
            return Ok(restarted);
        }
        let id = Uuid::now_v7();
        // The unique indexes refuse a second running generation and a
        // second onboarding one.
        let inserted = sqlx::query!(
            r#"INSERT INTO suggestion_generation (id, user_id, trigger, status, started_at)
               SELECT $1, $2, $3, 'generating', $4
               WHERE NOT EXISTS (
                   SELECT 1 FROM suggestion_generation
                   WHERE user_id = $2 AND $3 = 'nightly' AND started_at > $5)
               ON CONFLICT DO NOTHING"#,
            id,
            user.as_ref(),
            trigger.as_ref(),
            now,
            nightly_since,
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();
        tx.commit().await?;
        Ok((inserted == 1).then_some(id))
    }

    async fn finish(
        &self,
        generation: Uuid,
        ready: bool,
        now: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"UPDATE suggestion_generation SET status = $2, finished_at = $3 WHERE id = $1"#,
            generation,
            if ready { "ready" } else { "failed" },
            now,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
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
                 (session_id, generation_id, user_id, agent_id, kind, surfaces, opened_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
            session,
            generation,
            user.as_ref(),
            agent.as_uuid().to_string(),
            kind.as_ref(),
            surfaces,
            now,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn close_session(&self, session: Uuid) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"UPDATE suggestion_generation_session SET closed_at = now()
               WHERE session_id = $1 AND closed_at IS NULL"#,
            session,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn stale_sessions(
        &self,
        before: DateTime<Utc>,
        limit: u16,
    ) -> Result<Vec<StaleSession>, Self::Err> {
        let rows = sqlx::query!(
            r#"SELECT session_id, user_id, agent_id FROM suggestion_generation_session
               WHERE closed_at IS NULL AND opened_at < $1
               ORDER BY opened_at
               LIMIT $2"#,
            before,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(StaleSession {
                    session: row.session_id,
                    user: user(row.user_id)?,
                    agent: BotId::new_from_uuid(
                        row.agent_id
                            .parse()
                            .map_err(|_| PgGenerationRepoError::Decode("an agent id".to_owned()))?,
                    ),
                })
            })
            .collect()
    }

    async fn see(
        &self,
        user: &MacroUserIdStr<'_>,
        timezone: &str,
        now: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"INSERT INTO suggestion_audience (user_id, timezone, seen_at) VALUES ($1, $2, $3)
               ON CONFLICT (user_id) DO UPDATE SET timezone = EXCLUDED.timezone, seen_at = EXCLUDED.seen_at"#,
            user.as_ref(),
            timezone,
            now,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn due(
        &self,
        now: DateTime<Utc>,
        seen_since: DateTime<Utc>,
        nightly_since: DateTime<Utc>,
        night: (u8, u8),
        limit: u16,
    ) -> Result<Vec<AudienceMember>, Self::Err> {
        let rows = sqlx::query!(
            r#"SELECT a.user_id, a.timezone FROM suggestion_audience a
               WHERE a.seen_at > $2
                 AND extract(hour FROM $1 AT TIME ZONE a.timezone)::int >= $4
                 AND extract(hour FROM $1 AT TIME ZONE a.timezone)::int < $5
                 AND NOT EXISTS (
                     SELECT 1 FROM suggestion_generation g
                     WHERE g.user_id = a.user_id
                       AND (g.status = 'generating' OR g.started_at > $3))
               ORDER BY a.seen_at
               LIMIT $6"#,
            now,
            seen_since,
            nightly_since,
            i32::from(night.0),
            i32::from(night.1),
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(AudienceMember {
                    user: user(row.user_id)?,
                    timezone: row
                        .timezone
                        .parse()
                        .map_err(|_| PgGenerationRepoError::Decode("a time zone".to_owned()))?,
                })
            })
            .collect()
    }
}

#[async_trait::async_trait]
impl GenerationSessions for PgGenerationRepo {
    async fn open_session(
        &self,
        session: Uuid,
    ) -> Result<Option<GenerationSession>, rootcause::Report> {
        let row = sqlx::query!(
            r#"SELECT session_id, generation_id, user_id, kind, surfaces
               FROM suggestion_generation_session
               WHERE session_id = $1 AND closed_at IS NULL"#,
            session,
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
            })
        })
        .transpose()
    }
}

#[async_trait::async_trait]
impl SuggestionAudience for PgGenerationRepo {
    async fn seen(
        &self,
        user: &MacroUserIdStr<'_>,
        timezone: &str,
        now: DateTime<Utc>,
    ) -> Result<(), rootcause::Report> {
        self.see(user, timezone, now)
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())
    }
}

#[async_trait::async_trait]
impl GenerationStatuses for PgGenerationRepo {
    async fn latest(&self, user: &MacroUserIdStr<'_>) -> anyhow::Result<Option<GenerationStatus>> {
        let status = sqlx::query_scalar!(
            r#"SELECT status FROM suggestion_generation WHERE user_id = $1
               ORDER BY started_at DESC, id DESC LIMIT 1"#,
            user.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        status
            .map(|status| Ok(status.parse::<GenerationStatus>()?))
            .transpose()
    }
}
