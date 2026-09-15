//! Persist the PR association on the session row.

use super::*;

impl crate::domain::pull_request::SessionPullRequestRepo for PgAgentSessionRepo {
    async fn record_pull_request(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        url: &str,
        claim: Option<SessionClaim>,
    ) -> Result<bool> {
        let mut transaction = self.pool.begin().await.map_err(anyhow::Error::from)?;
        if let Some(claim) = claim {
            if claim.session != session {
                return Err(AgentSessionError::FencedOut(session));
            }
            // Takeover changes this same row, so the claim stays valid through commit.
            let locked = sqlx::query_scalar!(
                r#"
            SELECT id
            FROM agent_session
            WHERE id = $1 AND manager_replica_id = $2 AND manager_fence = $3
            FOR UPDATE
            "#,
                session.as_uuid(),
                claim.replica.as_uuid(),
                claim.fence.0,
            )
            .fetch_optional(&mut *transaction)
            .await
            .map_err(anyhow::Error::from)?;
            if locked.is_none() {
                return Err(AgentSessionError::FencedOut(session));
            }
        }
        let result = sqlx::query!(
            "UPDATE agent_session SET pull_request_url = $3, modified_at = clock_timestamp() WHERE id = $1 AND owner_id = $2 AND pull_request_url IS DISTINCT FROM $3",
            session.as_uuid(), owner.as_ref(), url,
        )
        .execute(&mut *transaction)
        .await
        .map_err(anyhow::Error::from)?;
        transaction.commit().await.map_err(anyhow::Error::from)?;
        Ok(result.rows_affected() == 1)
    }
}
