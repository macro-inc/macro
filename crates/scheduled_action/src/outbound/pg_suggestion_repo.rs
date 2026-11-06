use anyhow::Result;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::Surface;
use serde_json::{Map, Value};
use sqlx::PgPool;

use crate::domain::suggestions::model::{
    CheckedSuggestion, GenerationStatus, RoutineSuggestion, StoredGeneration, SuggestionPick,
};
use crate::domain::suggestions::ports::SuggestionRepo;

#[cfg(test)]
mod test;

/// PostgreSQL store for routine suggestions: one generation row per person,
/// one row per suggestion. A suggestion counts as accepted while a routine
/// points back to it through `scheduled_action.suggestion_id`.
pub struct PgSuggestionRepo {
    pool: PgPool,
}

impl PgSuggestionRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

struct SuggestionRow {
    id: Uuid,
    surface: String,
    catalog_key: Option<String>,
    knob_values: Value,
    title: Option<String>,
    request: Option<String>,
    reason: String,
    keep_probability: f32,
}

fn pick(
    catalog_key: Option<String>,
    knob_values: Value,
    title: Option<String>,
    request: Option<String>,
) -> Result<SuggestionPick> {
    Ok(match (catalog_key, title, request) {
        (Some(key), _, _) => SuggestionPick::Starter {
            key,
            knobs: serde_json::from_value::<Map<String, Value>>(knob_values)?,
        },
        (None, Some(title), Some(request)) => SuggestionPick::Request { title, request },
        _ => anyhow::bail!("a stored suggestion is neither a catalog routine nor a request"),
    })
}

fn surface(name: String) -> Result<Surface> {
    Ok(serde_json::from_value(Value::String(name))?)
}

fn surface_name(surface: Surface) -> Result<String> {
    match serde_json::to_value(surface)? {
        Value::String(name) => Ok(name),
        other => anyhow::bail!("surface serialized as {other}"),
    }
}

impl TryFrom<SuggestionRow> for RoutineSuggestion {
    type Error = anyhow::Error;

    fn try_from(row: SuggestionRow) -> Result<Self> {
        Ok(Self {
            id: row.id,
            surface: surface(row.surface)?,
            reason: row.reason,
            keep_probability: row.keep_probability,
            safe_default: false,
            pick: pick(row.catalog_key, row.knob_values, row.title, row.request)?,
        })
    }
}

impl SuggestionRepo for PgSuggestionRepo {
    async fn generation(&self, user: &MacroUserIdStr<'_>) -> Result<Option<StoredGeneration>> {
        let row = sqlx::query!(
            r#"
            SELECT status, generation_id, inputs, started_at, generated_at
            FROM routine_suggestion_generation
            WHERE user_id = $1
            "#,
            user.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            Ok(StoredGeneration {
                status: row.status.parse::<GenerationStatus>()?,
                generation_id: row.generation_id,
                inputs: row.inputs,
                started_at: row.started_at,
                generated_at: row.generated_at,
            })
        })
        .transpose()
    }

    async fn claim(
        &self,
        user: &MacroUserIdStr<'_>,
        generation_id: Uuid,
        now: DateTime<Utc>,
        reclaim_before: DateTime<Utc>,
    ) -> Result<bool> {
        // One statement, so two readers can't both start a generation.
        let claimed = sqlx::query!(
            r#"
            INSERT INTO routine_suggestion_generation (user_id, status, generation_id, started_at)
            VALUES ($1, 'generating', $2, $3)
            ON CONFLICT (user_id) DO UPDATE
            SET status = 'generating', generation_id = EXCLUDED.generation_id,
                started_at = EXCLUDED.started_at
            WHERE routine_suggestion_generation.status <> 'generating'
               OR routine_suggestion_generation.started_at < $4
            "#,
            user.as_ref(),
            generation_id,
            now,
            reclaim_before,
        )
        .execute(&self.pool)
        .await?;
        Ok(claimed.rows_affected() == 1)
    }

    async fn complete(
        &self,
        user: &MacroUserIdStr<'_>,
        generation_id: Uuid,
        inputs: &str,
        suggestions: &[CheckedSuggestion],
        now: DateTime<Utc>,
    ) -> Result<bool> {
        let mut tx = self.pool.begin().await?;
        let owned = sqlx::query!(
            r#"
            UPDATE routine_suggestion_generation
            SET status = 'ready', inputs = $3, generated_at = $4
            WHERE user_id = $1 AND generation_id = $2
            "#,
            user.as_ref(),
            generation_id,
            inputs,
            now,
        )
        .execute(&mut *tx)
        .await?;
        if owned.rows_affected() == 0 {
            return Ok(false);
        }
        // Dismissed and accepted suggestions stay: they keep "not
        // interested" across generations and the routine's link back.
        sqlx::query!(
            r#"
            DELETE FROM routine_suggestion s
            WHERE s.user_id = $1 AND s.state = 'open'
              AND NOT EXISTS (SELECT 1 FROM scheduled_action a WHERE a.owner = s.user_id AND a.suggestion_id = s.id)
            "#,
            user.as_ref(),
        )
        .execute(&mut *tx)
        .await?;
        for (position, suggestion) in suggestions.iter().enumerate() {
            let (catalog_key, knob_values, title, request) = match &suggestion.pick {
                SuggestionPick::Starter { key, knobs } => {
                    (Some(key.as_str()), Value::Object(knobs.clone()), None, None)
                }
                SuggestionPick::Request { title, request } => (
                    None,
                    Value::Object(Map::new()),
                    Some(title.as_str()),
                    Some(request.as_str()),
                ),
            };
            sqlx::query!(
                r#"
                INSERT INTO routine_suggestion
                    (id, user_id, generation_id, position, surface, catalog_key, knob_values,
                     title, request, reason, keep_probability, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                "#,
                Uuid::now_v7(),
                user.as_ref(),
                generation_id,
                i16::try_from(position)?,
                surface_name(suggestion.surface)?,
                catalog_key,
                knob_values,
                title,
                request,
                suggestion.reason,
                suggestion.keep_probability,
                now,
            )
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(true)
    }

    async fn fail(&self, user: &MacroUserIdStr<'_>, generation_id: Uuid) -> Result<()> {
        sqlx::query!(
            r#"
            UPDATE routine_suggestion_generation SET status = 'failed'
            WHERE user_id = $1 AND generation_id = $2
            "#,
            user.as_ref(),
            generation_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn open(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<RoutineSuggestion>> {
        let rows = sqlx::query_as!(
            SuggestionRow,
            r#"
            SELECT s.id, s.surface, s.catalog_key, s.knob_values, s.title, s.request, s.reason,
                   s.keep_probability
            FROM routine_suggestion s
            WHERE s.user_id = $1 AND s.state = 'open'
              AND NOT EXISTS (SELECT 1 FROM scheduled_action a WHERE a.owner = s.user_id AND a.suggestion_id = s.id)
            ORDER BY s.position
            "#,
            user.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(RoutineSuggestion::try_from).collect()
    }

    async fn dismissed(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<SuggestionPick>> {
        let rows = sqlx::query!(
            r#"
            SELECT catalog_key, knob_values, title, request
            FROM routine_suggestion
            WHERE user_id = $1 AND state = 'dismissed'
            ORDER BY updated_at DESC
            LIMIT 50
            "#,
            user.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| pick(row.catalog_key, row.knob_values, row.title, row.request))
            .collect()
    }

    async fn dismiss(&self, user: &MacroUserIdStr<'_>, id: Uuid) -> Result<bool> {
        let dismissed = sqlx::query!(
            r#"
            UPDATE routine_suggestion SET state = 'dismissed', updated_at = now()
            WHERE id = $1 AND user_id = $2
            "#,
            id,
            user.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(dismissed.rows_affected() == 1)
    }
}
