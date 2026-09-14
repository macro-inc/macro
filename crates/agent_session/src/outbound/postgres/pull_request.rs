//! Persist the PR association on the session row.

use super::*;

impl crate::domain::pull_request::SessionPullRequestRepo for PgAgentSessionRepo {
    async fn record_pull_request(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        url: &str,
    ) -> Result<bool> {
        let result = sqlx::query!(
            "UPDATE agent_session SET pull_request_url = $3, modified_at = clock_timestamp() WHERE id = $1 AND owner_id = $2 AND pull_request_url IS DISTINCT FROM $3",
            session.as_uuid(), owner.as_ref(), url,
        )
        .execute(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;
        Ok(result.rows_affected() == 1)
    }
}
