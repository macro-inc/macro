use super::*;
use crate::domain::recovery::StaleSessionRepo;
use agent_fold::domain::model::TurnState;

impl<B: BotFacts + 'static> StaleSessionRepo for PgAgentSessionRepo<B> {
    async fn stale_claims(&self, limit: NonZeroUsize) -> Result<Vec<SessionClaim>> {
        let rows = sqlx::query!(
            r#"
            SELECT session.id, session.manager_replica_id AS "replica!", session.manager_fence
            FROM agent_session AS session
            JOIN harness_replica AS replica ON replica.id = session.manager_replica_id
            WHERE session.manager_replica_id IS NOT NULL
              AND replica.last_heartbeat_at <= now() - make_interval(secs => $1)
            ORDER BY session.manager_replica_id, session.id
            LIMIT $2
            "#,
            REPLICA_STALE_AFTER.as_secs_f64(),
            i64::try_from(limit.get()).unwrap_or(i64::MAX),
        )
        .fetch_all(&self.pool)
        .await
        .context("list abandoned session claims")?;
        Ok(rows
            .into_iter()
            .map(|row| SessionClaim {
                session: AgentSessionId::new_from_uuid(row.id),
                replica: ReplicaId::from_uuid(row.replica),
                fence: ManagerFence(row.manager_fence),
            })
            .collect())
    }

    async fn disconnect_stale_claim(
        &self,
        claim: SessionClaim,
    ) -> Result<Option<StoredAgentSessionLog>> {
        let log = AgentSessionLog {
            agent_session_id: claim.session,
            user_id: None,
            content: Message::ToServer(ToServerMessage::Event {
                event: SystemEvent::Disconnected,
            }),
        };
        let (direction, content) = message_columns(&log.content)?;
        let status = SessionStatus::Event(SystemEvent::Disconnected);
        let (status, status_event_name) = status_columns(&status);
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("begin abandoned session recovery")?;
        // Match claim's replica-before-session lock order. A heartbeat that
        // commits while this waits must be seen by the next statement; one
        // arriving after this lock waits until revocation is durable.
        sqlx::query_scalar!(
            "SELECT id FROM harness_replica WHERE id = $1 FOR UPDATE",
            claim.replica.as_uuid(),
        )
        .fetch_optional(&mut *transaction)
        .await
        .context("lock abandoned replica heartbeat")?;
        // Claim changes and live appends lock this same row. An intervening
        // owner/fence change fails the predicate even after waiting for its
        // transaction; an old process that wakes later is fenced out.
        let revoked = sqlx::query_scalar!(
            r#"
            UPDATE agent_session AS session
            SET manager_replica_id = NULL,
                manager_fence = manager_fence + 1,
                status = $4, status_event_name = $5, turn_state = $6,
                modified_at = now()
            WHERE session.id = $1
              AND session.manager_replica_id = $2 AND session.manager_fence = $3
              AND EXISTS (
                SELECT 1 FROM harness_replica AS replica
                WHERE replica.id = session.manager_replica_id
                  AND replica.last_heartbeat_at <= now() - make_interval(secs => $7)
              )
            RETURNING session.id
            "#,
            claim.session.as_uuid(),
            claim.replica.as_uuid(),
            claim.fence.0,
            status,
            status_event_name,
            TurnState::Disconnected.as_ref(),
            REPLICA_STALE_AFTER.as_secs_f64(),
        )
        .fetch_optional(&mut *transaction)
        .await
        .context("revoke abandoned session claim")?;
        if revoked.is_none() {
            return Ok(None);
        }
        let id = macro_uuid::generate_uuid_v7();
        let created_at = sqlx::query_scalar!(
            r#"
            INSERT INTO agent_session_log (id, agent_session_id, user_id, direction, content, created_at)
            VALUES ($1, $2, $3, $4, $5, GREATEST(clock_timestamp(), (
                SELECT created_at + interval '1 microsecond'
                FROM agent_session_log WHERE agent_session_id = $2
                ORDER BY created_at DESC, id DESC LIMIT 1
            )))
            RETURNING created_at
            "#,
            id,
            claim.session.as_uuid(),
            Option::<&str>::None,
            direction,
            content,
        )
        .fetch_one(&mut *transaction)
        .await
        .context("append abandoned session disconnect")?;
        transaction
            .commit()
            .await
            .context("commit abandoned session recovery")?;
        Ok(Some(StoredAgentSessionLog {
            id,
            created_at,
            entry: log,
        }))
    }
}
