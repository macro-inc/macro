//! Session-owned runtime reconciliation reads.
use crate::domain::{
    model::{AgentSessionId, RuntimeSession},
    ports::RuntimeSessionLookup,
};
use agent_client_protocol::schema::v1::SessionId;
use bot_id::BotId;

/// Postgres runtime session lookup.
#[derive(Clone)]
pub struct PgRuntimeSessions(pub sqlx::PgPool);

impl RuntimeSessionLookup for PgRuntimeSessions {
    type Err = sqlx::Error;

    async fn sessions_for_bots(
        &self,
        bots: &[BotId],
        sessions: &[SessionId],
        dormant_before: chrono::DateTime<chrono::Utc>,
    ) -> Result<Vec<RuntimeSession>, Self::Err> {
        let bots: Vec<_> = bots.iter().map(|bot| bot.as_uuid()).collect();
        let sessions: Vec<_> = sessions.iter().map(ToString::to_string).collect();
        // Activity is the later of `modified_at`, which moves with turn starts,
        // blocks and metadata changes, and the newest log entry, which moves
        // with everything a turn does. A turn not yet ended or anything still
        // queued for the session keeps it out of dormancy however old.
        let rows = sqlx::query!(
            r#"
            SELECT s.id,
                (
                    GREATEST(s.modified_at, latest.created_at) < $3
                    AND s.turn_state IS DISTINCT FROM 'starting'
                    AND s.turn_state IS DISTINCT FROM 'running'
                    AND s.turn_state IS DISTINCT FROM 'blocked'
                    AND s.turn_state IS DISTINCT FROM 'stopping'
                    AND NOT s.turn_interrupted
                    AND NOT EXISTS (
                        SELECT 1 FROM agent_session_queue queue
                        WHERE queue.agent_session_id = s.id
                          AND jsonb_array_length(queue.entries) > 0
                    )
                    AND NOT EXISTS (
                        SELECT 1 FROM agent_session_tool_approval approval
                        WHERE approval.agent_session_id = s.id AND approval.status = 'pending'
                    )
                    AND NOT EXISTS (
                        SELECT 1 FROM agent_session_notification notification
                        WHERE notification.session_id = s.id AND notification.delivered_at IS NULL
                    )
                    AND NOT EXISTS (
                        SELECT 1 FROM agent_conversation_sessions conversation
                        WHERE conversation.session_id = s.id AND conversation.is_current
                    )
                ) AS "dormant!"
            FROM agent_session s
            LEFT JOIN LATERAL (
                SELECT created_at FROM agent_session_log
                WHERE agent_session_id = s.id ORDER BY created_at DESC LIMIT 1
            ) latest ON true
            WHERE s.bot_id = ANY($1)
              AND s.acp_session_id = ANY($2)
              AND s.archived_by IS NULL
            "#,
            &bots,
            &sessions,
            dormant_before,
        )
        .fetch_all(&self.0)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| RuntimeSession {
                id: AgentSessionId::new_from_uuid(row.id),
                dormant: row.dormant,
            })
            .collect())
    }
}
