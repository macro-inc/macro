use std::str::FromStr;

use anyhow::Result;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::Surface;
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use crate::domain::models::ActionConfiguration;
use crate::domain::suggestions::MAX_KEPT_PER_SESSION;
use crate::domain::suggestions::model::{CheckedSuggestion, StoredPick, StoredSuggestion};
use crate::domain::suggestions::ports::{Kept, SuggestionRepo};
use crate::domain::suggestions::state::{
    RoutineSuggestionEvent, RoutineSuggestionState, Transition,
};

#[cfg(test)]
mod test;

/// PostgreSQL store for routine suggestions: one row per suggestion, with its
/// `state`, and a `suggestion_change` row for each one a session kept or
/// retired. Every state change goes through [`transition`], which applies
/// [`RoutineSuggestionState::on`] to the row and its card together.
pub struct PgSuggestionRepo {
    pool: PgPool,
}

impl PgSuggestionRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// What [`transition`] did to a routine suggestion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Applied {
    pub transition: Transition,
    /// The card that moved with it, when it has one.
    pub card: Option<Uuid>,
}

/// Apply `event` to `user`'s routine suggestion `id` as
/// [`RoutineSuggestionState::on`] says, moving its card with it; what that
/// did, or none when it isn't theirs. Locks the row for the rest of the
/// transaction, so concurrent events apply one after the other.
pub(crate) async fn transition(
    conn: &mut PgConnection,
    user: &str,
    id: Uuid,
    event: RoutineSuggestionEvent,
    at: DateTime<Utc>,
) -> Result<Option<Applied>> {
    let state = sqlx::query_scalar!(
        "SELECT state FROM routine_suggestion WHERE id = $1 AND user_id = $2 FOR UPDATE",
        id,
        user,
    )
    .fetch_optional(&mut *conn)
    .await?;
    let Some(state) = state else {
        return Ok(None);
    };
    let from = RoutineSuggestionState::from_str(&state)?;
    let transition = from.on(event);
    let Transition::Move(to) = transition else {
        return Ok(Some(Applied {
            transition,
            card: None,
        }));
    };
    let moved = sqlx::query!(
        r#"UPDATE routine_suggestion
           SET state = $3, dismissed_at = COALESCE($4, dismissed_at), retired_at = COALESCE($5, retired_at)
           WHERE id = $1 AND state = $2"#,
        id,
        from.as_ref(),
        to.as_ref(),
        (to == RoutineSuggestionState::Dismissed).then_some(at),
        (to == RoutineSuggestionState::Retired).then_some(at),
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();
    anyhow::ensure!(moved == 1, "a locked routine suggestion moved meanwhile");
    let card = suggestions_db_utils::move_routine_card(
        conn,
        id,
        from.card().as_ref(),
        to.card().as_ref(),
        at,
    )
    .await?;
    Ok(Some(Applied { transition, card }))
}

/// `owner` saved routine `routine` from suggestion `suggestion`: their
/// routine suggestion is saved, and its card is done and produced the
/// routine. A template's id or someone else's suggestion changes nothing.
pub(crate) async fn save(
    conn: &mut PgConnection,
    owner: &str,
    suggestion: Uuid,
    routine: Uuid,
    at: DateTime<Utc>,
) -> Result<()> {
    let applied = transition(conn, owner, suggestion, RoutineSuggestionEvent::Save, at).await?;
    if let Some(Applied {
        transition: Transition::Move(_),
        card: Some(card),
    }) = applied
    {
        suggestions_db_utils::add_produced_routine(conn, card, routine).await?;
    }
    Ok(())
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
        let mut tx = self.pool.begin().await?;
        // Counted and checked under the person's lock, so two sessions keeping
        // at once can't both pass. Dropping the transaction keeps nothing.
        suggestions_db_utils::lock_user(&mut tx, user.as_ref()).await?;
        let checks = sqlx::query!(
            r#"SELECT
                 (SELECT count(*) FROM routine_suggestion
                  WHERE user_id = $1 AND session_id = $2) AS "kept!",
                 ($3::text IS NOT NULL AND (
                    EXISTS (SELECT 1 FROM routine_suggestion
                            WHERE user_id = $1 AND catalog_key = $3 AND state <> 'retired')
                    OR EXISTS (SELECT 1 FROM routine_suggestion_dismissed_template
                               WHERE user_id = $1 AND catalog_key = $3))) AS "taken!""#,
            user.as_ref(),
            session,
            catalog_key,
        )
        .fetch_one(&mut *tx)
        .await?;
        if checks.kept >= i64::from(MAX_KEPT_PER_SESSION) {
            return Ok(Kept::SessionFull);
        }
        if checks.taken {
            return Ok(Kept::Taken);
        }
        // The open catalog key index refuses a pick the previous release,
        // which takes no lock, kept meanwhile.
        let inserted = sqlx::query!(
            r#"INSERT INTO routine_suggestion
                 (id, user_id, session_id, surfaces, catalog_key, knob_values, routine, reason, keep_probability, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT DO NOTHING"#,
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
        .await?
        .rows_affected();
        if inserted == 0 {
            return Ok(Kept::Taken);
        }
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
        if let Some(card) = &suggestion.card {
            let categories: Vec<String> = card
                .categories
                .iter()
                .map(|category| category.as_ref().to_owned())
                .collect();
            let room = suggestions_db_utils::add_routine_card(
                &mut tx,
                &suggestions_db_utils::NewRoutineSuggestionCard {
                    user: user.as_ref(),
                    suggestion: id,
                    title: &card.title,
                    summary: &suggestion.reason,
                    importance: i16::from(card.importance),
                    categories: &categories,
                    session,
                    generation,
                    at: now,
                },
                suggestions::domain::service::OPEN_LIMIT,
                suggestions::domain::service::NEW_PER_GENERATION,
            )
            .await?;
            match room {
                suggestions_db_utils::Room::Fits => {}
                suggestions_db_utils::Room::OpenFull => return Ok(Kept::SuggestionsFull),
                suggestions_db_utils::Room::GenerationFull => return Ok(Kept::NightFull),
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
        let applied = transition(
            &mut tx,
            user.as_ref(),
            id,
            RoutineSuggestionEvent::Retire,
            now,
        )
        .await?;
        let Some(Applied {
            transition: Transition::Move(_),
            card,
        }) = applied
        else {
            return Ok(false);
        };
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
        if let Some(card) = card {
            suggestions_db_utils::log_change(
                &mut tx,
                user.as_ref(),
                card,
                &suggestions_db_utils::SuggestionChange {
                    generation,
                    session,
                    action: "retired",
                    old: None,
                    new: None,
                    reason: Some(reason),
                    at: now,
                },
            )
            .await?;
        }
        tx.commit().await?;
        Ok(true)
    }

    async fn suggestions(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<StoredSuggestion>> {
        let rows = sqlx::query!(
            r#"SELECT id, surfaces, catalog_key, knob_values, routine, reason, keep_probability,
                      state, dismissed_at, retired_at, created_at
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
                    state: RoutineSuggestionState::from_str(&row.state)?,
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

    async fn dismiss(&self, user: &MacroUserIdStr<'_>, id: Uuid) -> Result<Option<Transition>> {
        let mut tx = self.pool.begin().await?;
        let applied = transition(
            &mut tx,
            user.as_ref(),
            id,
            RoutineSuggestionEvent::Dismiss,
            Utc::now(),
        )
        .await?;
        tx.commit().await?;
        Ok(applied.map(|applied| applied.transition))
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

    async fn drafted(
        &self,
        user: &MacroUserIdStr<'_>,
        ids: &[Uuid],
    ) -> Result<Vec<(Uuid, ActionConfiguration)>> {
        let rows = sqlx::query!(
            r#"SELECT id, routine AS "routine!" FROM routine_suggestion
               WHERE id = ANY($1) AND user_id = $2 AND routine IS NOT NULL"#,
            ids,
            user.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| Ok((row.id, serde_json::from_value(row.routine)?)))
            .collect()
    }
}
