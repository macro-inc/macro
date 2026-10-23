//! Alone-timeout state on active calls. Every sweeper instance writes it, so
//! each transition is one conditional statement that only one writer wins.

use super::*;

#[cfg(test)]
mod test;

impl PgCallRepo {
    #[tracing::instrument(err, skip(self))]
    pub(super) async fn start_alone(
        &self,
        call_id: &Uuid,
        now: DateTime<Utc>,
    ) -> Result<Option<AloneCallState>, CallError> {
        let row = sqlx::query!(
            r#"UPDATE calls SET alone_since = COALESCE(alone_since, $2) WHERE id = $1
               RETURNING alone_since AS "alone_since!", alone_warned_at, alone_since = $2 AS "newly_alone!""#,
            call_id,
            now,
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|row| AloneCallState {
            alone_since: row.alone_since,
            warned_at: row.alone_warned_at,
            newly_alone: row.newly_alone,
        }))
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn record_alone_warning(
        &self,
        call_id: &Uuid,
        now: DateTime<Utc>,
        alone_by: DateTime<Utc>,
    ) -> Result<Option<DateTime<Utc>>, CallError> {
        Ok(sqlx::query_scalar!(
            r#"UPDATE calls SET alone_warned_at = $2
               WHERE id = $1 AND alone_warned_at IS NULL AND alone_since <= $3
               RETURNING alone_warned_at AS "alone_warned_at!""#,
            call_id,
            now,
            alone_by,
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn clear_alone(&self, call_id: &Uuid) -> Result<bool, CallError> {
        // Clearing a warning is its own statement so exactly one concurrent
        // writer observes it and notifies.
        let cleared_warning = sqlx::query!(
            "UPDATE calls SET alone_since = NULL, alone_warned_at = NULL WHERE id = $1 AND alone_warned_at IS NOT NULL",
            call_id,
        )
        .execute(&self.pool)
        .await?
        .rows_affected()
            > 0;
        if !cleared_warning {
            // A warning another instance records between the two statements
            // must keep its alone period; the next accompanied sweep clears
            // both and notifies.
            sqlx::query!(
                "UPDATE calls SET alone_since = NULL WHERE id = $1 AND alone_since IS NOT NULL AND alone_warned_at IS NULL",
                call_id,
            )
            .execute(&self.pool)
            .await?;
        }
        Ok(cleared_warning)
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn reset_alone(
        &self,
        call_id: &Uuid,
        user_id: MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> Result<bool, CallError> {
        Ok(sqlx::query!(
            r#"UPDATE calls SET alone_since = $3, alone_warned_at = NULL
               WHERE id = $1 AND EXISTS (
                   SELECT 1 FROM call_participants
                   WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL
               )"#,
            call_id,
            user_id.as_ref(),
            now,
        )
        .execute(&self.pool)
        .await?
        .rows_affected()
            > 0)
    }
}
