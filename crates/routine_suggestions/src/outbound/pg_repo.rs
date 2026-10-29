//! Postgres implementation of [`RoutineSuggestionRepo`].

use std::str::FromStr;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::model::{RoutineSuggestion, StoredSuggestionSet, SuggestionSetStatus};
use crate::domain::ports::RoutineSuggestionRepo;

#[cfg(test)]
mod test;

/// Errors from [`PgRoutineSuggestionRepo`].
#[derive(Debug, thiserror::Error)]
pub enum PgRoutineSuggestionRepoError {
    /// The query failed.
    #[error("routine suggestion query failed")]
    Query(#[from] sqlx::Error),
    /// A stored row does not decode.
    #[error("stored routine suggestions are malformed: {0}")]
    Malformed(String),
    /// Suggestions did not encode.
    #[error("routine suggestions did not encode")]
    Encode(#[from] serde_json::Error),
}

/// Suggestion sets in MacroDB's `routine_suggestion_set`.
#[derive(Clone)]
pub struct PgRoutineSuggestionRepo {
    pool: PgPool,
}

impl PgRoutineSuggestionRepo {
    /// Builds the repository on the MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl RoutineSuggestionRepo for PgRoutineSuggestionRepo {
    type Err = PgRoutineSuggestionRepoError;

    #[tracing::instrument(skip(self), fields(user_id = %user.as_ref()), err)]
    async fn get(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Option<StoredSuggestionSet>, Self::Err> {
        let Some(row) = sqlx::query!(
            r#"
            SELECT status, suggestions, started_at, generated_at
            FROM routine_suggestion_set
            WHERE user_id = $1
            "#,
            user.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?
        else {
            return Ok(None);
        };
        let status = SuggestionSetStatus::from_str(&row.status)
            .map_err(|_| PgRoutineSuggestionRepoError::Malformed(row.status.clone()))?;
        // Suggestions are rewritten every few days, so a shape change only
        // affects rows until their next generation: drop what no longer
        // decodes instead of failing the read.
        let suggestions = match row.suggestions {
            serde_json::Value::Array(items) => items
                .into_iter()
                .filter_map(|item| serde_json::from_value::<RoutineSuggestion>(item).ok())
                .collect(),
            other => {
                return Err(PgRoutineSuggestionRepoError::Malformed(format!(
                    "suggestions is not an array: {other}"
                )));
            }
        };
        Ok(Some(StoredSuggestionSet {
            status,
            suggestions,
            started_at: row.started_at,
            generated_at: row.generated_at,
        }))
    }

    #[tracing::instrument(skip(self), fields(user_id = %user.as_ref()), err)]
    async fn claim(
        &self,
        user: &MacroUserIdStr<'static>,
        generation_id: Uuid,
        now: DateTime<Utc>,
        reclaim_before: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        // One statement, so two readers that both find the set stale cannot
        // both start a generation: the second sees the first's claim.
        let claimed = sqlx::query_scalar!(
            r#"
            INSERT INTO routine_suggestion_set (user_id, status, generation_id, started_at)
            VALUES ($1, 'generating', $2, $3)
            ON CONFLICT (user_id) DO UPDATE
            SET status = 'generating',
                generation_id = EXCLUDED.generation_id,
                started_at = EXCLUDED.started_at
            WHERE routine_suggestion_set.status <> 'generating'
               OR routine_suggestion_set.started_at < $4
            RETURNING generation_id
            "#,
            user.as_ref(),
            generation_id,
            now,
            reclaim_before,
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(claimed.is_some())
    }

    #[tracing::instrument(skip(self, suggestions), fields(user_id = %user.as_ref(), suggestions = suggestions.len()), err)]
    async fn complete(
        &self,
        user: &MacroUserIdStr<'static>,
        generation_id: Uuid,
        suggestions: &[RoutineSuggestion],
        now: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let suggestions = serde_json::to_value(suggestions)?;
        let result = sqlx::query!(
            r#"
            UPDATE routine_suggestion_set
            SET status = 'ready', suggestions = $3, generated_at = $4
            WHERE user_id = $1 AND generation_id = $2
            "#,
            user.as_ref(),
            generation_id,
            suggestions,
            now,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user.as_ref()), err)]
    async fn fail(
        &self,
        user: &MacroUserIdStr<'static>,
        generation_id: Uuid,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            UPDATE routine_suggestion_set
            SET status = 'failed'
            WHERE user_id = $1 AND generation_id = $2
            "#,
            user.as_ref(),
            generation_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
