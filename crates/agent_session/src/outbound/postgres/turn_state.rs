use super::*;
use crate::domain::turn_state::SessionTurnProjectionRepo;
use agent_fold::domain::model::TurnState;

impl SessionTurnProjectionRepo for PgAgentSessionRepo {
    async fn unprojected_sessions(&self, limit: NonZeroUsize) -> Result<Vec<AgentSessionId>> {
        let ids = sqlx::query_scalar!(
            "SELECT id FROM agent_session WHERE turn_state IS NULL ORDER BY id LIMIT $1",
            i64::try_from(limit.get()).unwrap_or(i64::MAX),
        )
        .fetch_all(&self.pool)
        .await
        .context("list sessions missing turn projection")?;
        Ok(ids.into_iter().map(AgentSessionId::new_from_uuid).collect())
    }

    async fn initialize_turn_state(
        &self,
        session: AgentSessionId,
        last_log_id: Option<Uuid>,
        turn_state: TurnState,
    ) -> Result<bool> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("begin turn projection backfill")?;
        // Lock before reading the log cursor in a separate statement: if a live
        // writer held the lock, the next statement gets a fresh snapshot after
        // that writer committed. Both the fence and null projection must survive.
        let locked = sqlx::query_scalar!(
            "SELECT id FROM agent_session WHERE id = $1 AND turn_state IS NULL FOR UPDATE",
            session.as_uuid(),
        )
        .fetch_optional(&mut *transaction)
        .await
        .context("lock missing turn projection")?;
        if locked.is_none() {
            return Ok(false);
        }
        let updated = sqlx::query!(
            r#"
            UPDATE agent_session
            SET turn_state = $3
            WHERE id = $1 AND turn_state IS NULL
              AND (SELECT id FROM agent_session_log WHERE agent_session_id = $1
                   ORDER BY created_at DESC, id DESC LIMIT 1) IS NOT DISTINCT FROM $2::uuid
            "#,
            session.as_uuid(),
            last_log_id,
            turn_state.as_ref(),
        )
        .execute(&mut *transaction)
        .await
        .context("initialize turn projection at unchanged log cursor")?;
        transaction
            .commit()
            .await
            .context("commit turn projection backfill")?;
        Ok(updated.rows_affected() == 1)
    }
}
