use anyhow::Result;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::Surface;
use serde_json::Value;
use sqlx::PgPool;

use crate::domain::suggestions::model::{CheckedSuggestion, StoredPick, StoredSuggestion};
use crate::domain::suggestions::ports::{Kept, SuggestionRepo};

#[cfg(test)]
mod test;

/// PostgreSQL store for routine suggestions: one row per suggestion, and a
/// `suggestion_change` row for each one a session kept or retired. A
/// suggestion counts as saved while a routine points back to it through
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

/// One change a routines session made, for the change log.
struct Change<'a> {
    session: Uuid,
    generation: Uuid,
    action: &'static str,
    new: Option<Value>,
    reason: Option<&'a str>,
    at: DateTime<Utc>,
}

async fn log(
    conn: &mut sqlx::PgConnection,
    user: &MacroUserIdStr<'_>,
    suggestion: Uuid,
    change: Change<'_>,
) -> Result<()> {
    sqlx::query!(
        r#"INSERT INTO suggestion_change
             (id, user_id, generation_id, session_id, subject, subject_id, action,
              new_value, reason, created_at)
           VALUES ($1, $2, $3, $4, 'routine_suggestion', $5, $6, $7, $8, $9)"#,
        Uuid::now_v7(),
        user.as_ref(),
        change.generation,
        change.session,
        suggestion,
        change.action,
        change.new,
        change.reason,
        change.at,
    )
    .execute(conn)
    .await?;
    Ok(())
}

impl SuggestionRepo for PgSuggestionRepo {
    async fn kept_by(&self, user: &MacroUserIdStr<'_>, session: Uuid) -> Result<u32> {
        // By person first: their index bounds the scan to their suggestions.
        let count = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM routine_suggestion
               WHERE user_id = $1 AND session_id = $2"#,
            user.as_ref(),
            session,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(u32::try_from(count).unwrap_or(u32::MAX))
    }

    async fn add(
        &self,
        user: &MacroUserIdStr<'_>,
        session: Uuid,
        generation: Uuid,
        suggestion: &CheckedSuggestion,
        now: DateTime<Utc>,
    ) -> Result<Kept> {
        let id = Uuid::now_v7();
        let mut tx = self.pool.begin().await?;
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
        .execute(&mut *tx)
        .await?;
        log(
            &mut tx,
            user,
            id,
            Change {
                session,
                generation,
                action: "created",
                new: Some(serde_json::to_value(&suggestion.pick)?),
                reason: Some(&suggestion.reason),
                at: now,
            },
        )
        .await?;
        if let Some(idea) = &suggestion.idea {
            let categories: Vec<String> = idea
                .categories
                .iter()
                .map(|category| category.as_ref().to_owned())
                .collect();
            let room = ideas_db_utils::add_routine_idea(
                &mut tx,
                &ideas_db_utils::NewRoutineIdea {
                    user: user.as_ref(),
                    suggestion: id,
                    title: &idea.title,
                    summary: &suggestion.reason,
                    importance: i16::from(idea.importance),
                    categories: &categories,
                    session,
                    generation,
                    at: now,
                },
                ideas::domain::service::OPEN_LIMIT,
                ideas::domain::service::NEW_PER_GENERATION,
            )
            .await?;
            match room {
                ideas_db_utils::Room::Fits => {}
                // Dropping the transaction keeps nothing.
                ideas_db_utils::Room::OpenFull => return Ok(Kept::IdeasFull),
                ideas_db_utils::Room::GenerationFull => return Ok(Kept::NightFull),
            }
        }
        tx.commit().await?;
        Ok(Kept::Stored(id))
    }

    async fn retire(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        session: Uuid,
        generation: Uuid,
        reason: &str,
        now: DateTime<Utc>,
    ) -> Result<bool> {
        let mut tx = self.pool.begin().await?;
        let retired = sqlx::query!(
            r#"UPDATE routine_suggestion SET retired_at = $3
               WHERE id = $1 AND user_id = $2 AND dismissed_at IS NULL AND retired_at IS NULL"#,
            id,
            user.as_ref(),
            now,
        )
        .execute(&mut *tx)
        .await?
        .rows_affected()
            == 1;
        if retired {
            log(
                &mut tx,
                user,
                id,
                Change {
                    session,
                    generation,
                    action: "retired",
                    new: None,
                    reason: Some(reason),
                    at: now,
                },
            )
            .await?;
            ideas_db_utils::close_routine_idea(
                &mut tx,
                id,
                "retired",
                Some(&ideas_db_utils::IdeaChange {
                    generation,
                    session,
                    action: "retired",
                    old: None,
                    new: None,
                    reason: Some(reason),
                    at: now,
                }),
                now,
            )
            .await?;
        }
        tx.commit().await?;
        Ok(retired)
    }

    async fn suggestions(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<StoredSuggestion>> {
        let rows = sqlx::query!(
            r#"SELECT id, surfaces, catalog_key, knob_values, routine, reason, keep_probability,
                      dismissed_at, retired_at, created_at
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
                    dismissed_at: row.dismissed_at,
                    retired_at: row.retired_at,
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
        let mut tx = self.pool.begin().await?;
        let found = sqlx::query!(
            r#"UPDATE routine_suggestion SET dismissed_at = COALESCE(dismissed_at, now())
               WHERE id = $1 AND user_id = $2"#,
            id,
            user.as_ref(),
        )
        .execute(&mut *tx)
        .await?
        .rows_affected()
            == 1;
        if found {
            ideas_db_utils::close_routine_idea(&mut tx, id, "dismissed", None, Utc::now()).await?;
        }
        tx.commit().await?;
        Ok(found)
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
