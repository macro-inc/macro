use super::*;
use crate::domain::abandoned_turn::AbandonedTurnRepo;
use std::time::Duration;

impl AbandonedTurnRepo for PgAgentSessionRepo {
    async fn abandoned_turns(
        &self,
        quiet_for: Duration,
        limit: NonZeroUsize,
    ) -> Result<Vec<AgentSessionId>> {
        // The turn-state list is `TurnState::is_open` spelled in SQL, and it
        // matches the partial index this reads through. A session with no log
        // at all falls back to its own age, so a row projected open by a
        // writer that died before its first frame is still reachable.
        let ids = sqlx::query_scalar!(
            r#"
            SELECT session.id
            FROM agent_session AS session
            WHERE session.turn_state IN ('starting', 'running', 'stopping', 'blocked')
              AND NOT EXISTS (
                  SELECT 1
                  FROM harness_replica live
                  WHERE live.id = session.manager_replica_id
                    AND live.last_heartbeat_at > now() - make_interval(secs => $1)
              )
              AND COALESCE(
                  (SELECT max(log.created_at)
                   FROM agent_session_log AS log
                   WHERE log.agent_session_id = session.id),
                  session.created_at
              ) < now() - make_interval(secs => $2)
            ORDER BY session.id
            LIMIT $3
            "#,
            REPLICA_STALE_AFTER.as_secs_f64(),
            quiet_for.as_secs_f64(),
            i64::try_from(limit.get()).unwrap_or(i64::MAX),
        )
        .fetch_all(&self.pool)
        .await
        .context("list agent sessions whose open turn no live replica is driving")?;
        Ok(ids.into_iter().map(AgentSessionId::new_from_uuid).collect())
    }
}
