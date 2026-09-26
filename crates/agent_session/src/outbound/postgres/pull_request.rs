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
        // The pull request the agent opened is linked like any other, and outranks a person's
        // earlier link to it.
        sqlx::query!(
            r#"
            INSERT INTO agent_session_pull_request (agent_session_id, github_key, source)
            SELECT $1, $2, 'agent'
            WHERE EXISTS (SELECT 1 FROM agent_session WHERE id = $1 AND owner_id = $3)
            ON CONFLICT (agent_session_id, github_key) DO UPDATE SET source = 'agent', linked_by = NULL
            "#,
            session.as_uuid(),
            url.trim_start_matches("https://github.com/"),
            owner.as_ref(),
        )
        .execute(&mut *transaction)
        .await
        .map_err(anyhow::Error::from)?;
        transaction.commit().await.map_err(anyhow::Error::from)?;
        Ok(result.rows_affected() == 1)
    }
}

impl crate::domain::pull_request_links::SessionPullRequestLinkRepo for PgAgentSessionRepo {
    async fn link_pull_request(
        &self,
        session: AgentSessionId,
        github_key: &str,
        linked_by: &MacroUserIdStr<'static>,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO agent_session_pull_request (agent_session_id, github_key, source, linked_by)
            VALUES ($1, $2, 'user', $3)
            ON CONFLICT (agent_session_id, github_key) DO NOTHING
            "#,
            session.as_uuid(),
            github_key,
            linked_by.as_ref(),
        )
        .execute(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;
        Ok(())
    }

    async fn unlink_pull_request(&self, session: AgentSessionId, github_key: &str) -> Result<bool> {
        let result = sqlx::query!(
            r#"
            DELETE FROM agent_session_pull_request
            WHERE agent_session_id = $1 AND lower(github_key) = lower($2) AND source = 'user'
            "#,
            session.as_uuid(),
            github_key,
        )
        .execute(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;
        Ok(result.rows_affected() > 0)
    }

    async fn session_pull_requests(
        &self,
        session: AgentSessionId,
    ) -> Result<Vec<crate::domain::pull_request_links::SessionPullRequestLink>> {
        use crate::domain::pull_request_links::{PullRequestLinkSource, SessionPullRequestLink};

        let rows = sqlx::query!(
            r#"
            SELECT github_key, source, linked_by, created_at
            FROM agent_session_pull_request
            WHERE agent_session_id = $1
            ORDER BY created_at, github_key
            "#,
            session.as_uuid(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;

        Ok(rows
            .into_iter()
            .map(|row| SessionPullRequestLink {
                url: format!("https://github.com/{}", row.github_key),
                github_key: row.github_key,
                source: if row.source == "agent" {
                    PullRequestLinkSource::Agent
                } else {
                    PullRequestLinkSource::User
                },
                linked_by: row.linked_by,
                created_at: row.created_at,
            })
            .collect())
    }

    async fn sessions_for_pull_request(&self, github_key: &str) -> Result<Vec<AgentSessionId>> {
        let ids = sqlx::query_scalar!(
            r#"
            SELECT agent_session_id
            FROM agent_session_pull_request
            WHERE lower(github_key) = lower($1)
            ORDER BY created_at, agent_session_id
            "#,
            github_key,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;
        Ok(ids.into_iter().map(AgentSessionId::new_from_uuid).collect())
    }
}
