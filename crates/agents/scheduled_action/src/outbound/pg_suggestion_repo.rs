use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::Surface;
use serde_json::Value;
use sqlx::PgPool;

use crate::domain::suggestions::model::{
    CheckedSuggestion, GenerationStatus, StoredGeneration, StoredPick, StoredSuggestion,
};
use crate::domain::suggestions::ports::{SuggestionRepo, SuggestionSession};

#[cfg(test)]
mod test;

/// PostgreSQL store for routine suggestions: one generation row per person,
/// one row per suggestion session and per suggestion. A suggestion counts as
/// saved while a routine points back to it through
/// `scheduled_action.suggestion_id`.
pub struct PgSuggestionRepo {
    pool: PgPool,
}

impl PgSuggestionRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn surfaces(names: Vec<String>) -> Result<Vec<Surface>> {
    names
        .into_iter()
        .map(|name| Ok(serde_json::from_value(Value::String(name))?))
        .collect()
}

fn surface_names(surfaces: &[Surface]) -> Result<Vec<String>> {
    surfaces
        .iter()
        .map(|surface| match serde_json::to_value(surface)? {
            Value::String(name) => Ok(name),
            other => anyhow::bail!("surface serialized as {other}"),
        })
        .collect()
}

fn session(
    session_id: Uuid,
    user_id: String,
    agent_id: String,
    names: Vec<String>,
    kept: Option<i64>,
) -> Result<SuggestionSession> {
    Ok(SuggestionSession {
        session: session_id,
        owner: MacroUserIdStr::try_from(user_id).context("a suggestion session's owner")?,
        agent: bot_id::BotId::new_from_uuid(
            agent_id.parse().context("a suggestion session's agent")?,
        ),
        surfaces: surfaces(names)?,
        kept: kept.unwrap_or(0).try_into().unwrap_or(u32::MAX),
    })
}

impl SuggestionRepo for PgSuggestionRepo {
    async fn generation(&self, user: &MacroUserIdStr<'_>) -> Result<Option<StoredGeneration>> {
        let row = sqlx::query!(
            r#"SELECT status, started_at, finished_at FROM routine_suggestion_generation WHERE user_id = $1"#,
            user.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            Ok(StoredGeneration {
                status: row.status.parse::<GenerationStatus>()?,
                started_at: row.started_at,
                finished_at: row.finished_at,
            })
        })
        .transpose()
    }

    async fn begin(
        &self,
        user: &MacroUserIdStr<'_>,
        now: DateTime<Utc>,
        stale_before: DateTime<Utc>,
    ) -> Result<bool> {
        let started = sqlx::query!(
            r#"INSERT INTO routine_suggestion_generation (user_id, status, started_at)
               VALUES ($1, 'generating', $2)
               ON CONFLICT (user_id) DO UPDATE SET started_at = EXCLUDED.started_at, finished_at = NULL
               WHERE routine_suggestion_generation.status = 'generating'
                 AND routine_suggestion_generation.started_at < $3"#,
            user.as_ref(),
            now,
            stale_before,
        )
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(started == 1)
    }

    async fn finish(
        &self,
        user: &MacroUserIdStr<'_>,
        ready: bool,
        now: DateTime<Utc>,
    ) -> Result<()> {
        sqlx::query!(
            r#"UPDATE routine_suggestion_generation SET status = $2, finished_at = $3 WHERE user_id = $1"#,
            user.as_ref(),
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
        user: &MacroUserIdStr<'_>,
        agent: bot_id::BotId,
        surfaces: &[Surface],
        now: DateTime<Utc>,
    ) -> Result<()> {
        sqlx::query!(
            r#"INSERT INTO routine_suggestion_session (session_id, user_id, agent_id, surfaces, opened_at)
               VALUES ($1, $2, $3, $4, $5)"#,
            session,
            user.as_ref(),
            agent.as_uuid().to_string(),
            &surface_names(surfaces)?,
            now,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn session(&self, session_id: Uuid) -> Result<Option<SuggestionSession>> {
        let row = sqlx::query!(
            r#"SELECT s.session_id, s.user_id, s.agent_id, s.surfaces,
                      (SELECT count(*) FROM routine_suggestion r WHERE r.session_id = s.session_id) AS kept
               FROM routine_suggestion_session s
               WHERE s.session_id = $1 AND s.closed_at IS NULL"#,
            session_id,
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            session(
                row.session_id,
                row.user_id,
                row.agent_id,
                row.surfaces,
                row.kept,
            )
        })
        .transpose()
    }

    async fn close_session(&self, session_id: Uuid) -> Result<()> {
        sqlx::query!(
            r#"UPDATE routine_suggestion_session SET closed_at = now()
               WHERE session_id = $1 AND closed_at IS NULL"#,
            session_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn stale_sessions(
        &self,
        before: DateTime<Utc>,
        limit: u16,
    ) -> Result<Vec<SuggestionSession>> {
        let rows = sqlx::query!(
            r#"SELECT session_id, user_id, agent_id, surfaces
               FROM routine_suggestion_session
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
                session(
                    row.session_id,
                    row.user_id,
                    row.agent_id,
                    row.surfaces,
                    None,
                )
            })
            .collect()
    }

    async fn add(
        &self,
        user: &MacroUserIdStr<'_>,
        session: Uuid,
        suggestion: &CheckedSuggestion,
        now: DateTime<Utc>,
    ) -> Result<Uuid> {
        let id = Uuid::now_v7();
        let (catalog_key, knob_values, routine) = match &suggestion.pick {
            StoredPick::Catalog { key, knobs } => {
                (Some(key.clone()), Value::Object(knobs.clone()), None)
            }
            StoredPick::Routine { routine } => (
                None,
                Value::Object(serde_json::Map::new()),
                Some(serde_json::to_value(routine)?),
            ),
        };
        sqlx::query!(
            r#"INSERT INTO routine_suggestion
                 (id, user_id, session_id, surfaces, catalog_key, knob_values, routine, reason, keep_probability, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"#,
            id,
            user.as_ref(),
            session,
            &surface_names(&suggestion.surfaces)?,
            catalog_key,
            knob_values,
            routine,
            suggestion.reason,
            suggestion.keep_probability,
            now,
        )
        .execute(&self.pool)
        .await?;
        Ok(id)
    }

    async fn suggestions(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<StoredSuggestion>> {
        let rows = sqlx::query!(
            r#"SELECT id, surfaces, catalog_key, knob_values, routine, reason, keep_probability,
                      dismissed_at IS NOT NULL AS "dismissed!", created_at
               FROM routine_suggestion
               WHERE user_id = $1
               ORDER BY created_at, id"#,
            user.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let pick = match (row.catalog_key, row.routine) {
                    (Some(key), _) => StoredPick::Catalog {
                        key,
                        knobs: serde_json::from_value(row.knob_values)?,
                    },
                    (None, Some(routine)) => StoredPick::Routine {
                        routine: serde_json::from_value(routine)?,
                    },
                    (None, None) => anyhow::bail!("a stored suggestion has no pick"),
                };
                Ok(StoredSuggestion {
                    id: row.id,
                    surfaces: surfaces(row.surfaces)?,
                    reason: row.reason,
                    keep_probability: row.keep_probability,
                    pick,
                    dismissed: row.dismissed,
                    created_at: row.created_at,
                })
            })
            .collect()
    }

    async fn dismissed_templates(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<String>> {
        Ok(sqlx::query_scalar!(
            r#"SELECT catalog_key FROM routine_suggestion_dismissed_template WHERE user_id = $1 ORDER BY dismissed_at"#,
            user.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?)
    }

    async fn dismiss(&self, user: &MacroUserIdStr<'_>, id: Uuid) -> Result<bool> {
        let found = sqlx::query!(
            r#"UPDATE routine_suggestion SET dismissed_at = COALESCE(dismissed_at, now())
               WHERE id = $1 AND user_id = $2"#,
            id,
            user.as_ref(),
        )
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(found == 1)
    }

    async fn dismiss_template(&self, user: &MacroUserIdStr<'_>, key: &str) -> Result<()> {
        sqlx::query!(
            r#"INSERT INTO routine_suggestion_dismissed_template (user_id, catalog_key)
               VALUES ($1, $2) ON CONFLICT DO NOTHING"#,
            user.as_ref(),
            key,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn saved_from(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<Uuid>> {
        Ok(sqlx::query_scalar!(
            r#"SELECT suggestion_id AS "suggestion_id!" FROM scheduled_action
               WHERE owner = $1 AND suggestion_id IS NOT NULL"#,
            user.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?)
    }
}
