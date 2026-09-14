//! Atomic session PR storage.

use super::*;

impl crate::domain::pull_request::SessionPullRequestRepo for PgAgentSessionRepo {
    async fn record_pull_request(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        url: &str,
    ) -> Result<Option<StoredAgentSessionLog>> {
        let mut transaction = self.pool.begin().await.map_err(anyhow::Error::from)?;
        let locked = sqlx::query_scalar!(
            "SELECT id FROM agent_session WHERE id = $1 AND owner_id = $2 FOR UPDATE",
            session.as_uuid(),
            owner.as_ref(),
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(anyhow::Error::from)?;
        if locked.is_none() {
            return Err(AgentSessionError::Forbidden);
        }
        let previous = sqlx::query_scalar!(
            "SELECT content->>'url' FROM agent_session_log WHERE agent_session_id = $1 AND direction = 'to_server' AND content->>'type' = 'pullRequestSet' ORDER BY created_at DESC, id DESC LIMIT 1",
            session.as_uuid(),
        ).fetch_optional(&mut *transaction).await.map_err(anyhow::Error::from)?.flatten();
        if previous.as_deref() == Some(url) {
            transaction.commit().await.map_err(anyhow::Error::from)?;
            return Ok(None);
        }
        let entry = AgentSessionLog {
            agent_session_id: session,
            user_id: Some(owner.clone()),
            content: Message::ToServer(ToServerMessage::PullRequestSet {
                url: url.to_owned(),
            }),
        };
        let id = macro_uuid::generate_uuid_v7();
        let (direction, content) = message_columns(&entry.content)?;
        let created_at = sqlx::query_scalar!(
            "INSERT INTO agent_session_log (id, agent_session_id, user_id, direction, content, created_at) VALUES ($1, $2, $3, $4, $5, clock_timestamp()) RETURNING created_at",
            id, session.as_uuid(), owner.as_ref(), direction, content,
        ).fetch_one(&mut *transaction).await.map_err(anyhow::Error::from)?;
        transaction.commit().await.map_err(anyhow::Error::from)?;
        Ok(Some(StoredAgentSessionLog {
            id,
            created_at,
            entry,
        }))
    }
}
