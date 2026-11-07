//! Postgres persistence for invocation-to-session mappings.

use crate::domain::{Correlation, CorrelationError, CorrelationRepository, SessionScope};
use async_trait::async_trait;
use uuid::Uuid;

/// Shared primary-database correlation repository.
#[derive(Clone)]
pub struct PgCorrelationRepository(pub sqlx::PgPool);

#[async_trait]
impl CorrelationRepository for PgCorrelationRepository {
    #[tracing::instrument(skip(self), err)]
    async fn create(
        &self,
        session: Uuid,
        agent: Uuid,
        scope: Option<SessionScope>,
    ) -> Result<Uuid, CorrelationError> {
        let id = Uuid::now_v7();
        let inserted = sqlx::query_scalar!(
            "INSERT INTO agent_correlations (id, agent_session_id, scope) SELECT $1, id, $4 FROM agent_session WHERE id = $2 AND bot_id = $3 RETURNING id",
            id, session, agent, scope.map(SessionScope::as_str),
        ).fetch_optional(&self.0).await
            .map_err(|error| CorrelationError::Unavailable(rootcause::report!(error).into_dynamic()))?;
        inserted.ok_or(CorrelationError::AgentMismatch)
    }

    #[tracing::instrument(skip(self), err)]
    async fn find(&self, id: Uuid) -> Result<Option<Correlation>, CorrelationError> {
        let row = sqlx::query!(
            "SELECT c.agent_session_id AS session_id, s.bot_id AS agent_id, c.scope FROM agent_correlations c JOIN agent_session s ON s.id = c.agent_session_id WHERE c.id = $1",
            id,
        ).fetch_optional(&self.0).await
            .map_err(|error| CorrelationError::Unavailable(rootcause::report!(error).into_dynamic()))?;
        row.map(|row| {
            // A scope this release doesn't know limits more than it can
            // tell: refuse the request rather than drop the limit.
            let scope = match row.scope.as_deref() {
                None => None,
                Some(name) => Some(SessionScope::parse(name).ok_or_else(|| {
                    CorrelationError::Unavailable(
                        rootcause::report!("unknown session scope {name}").into_dynamic(),
                    )
                })?),
            };
            Ok(Correlation {
                session_id: row.session_id,
                agent_id: row.agent_id,
                scope,
            })
        })
        .transpose()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;

    #[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
    async fn invocations_are_fresh_bound_to_agent_and_independent_of_session_state(
        pool: sqlx::PgPool,
    ) {
        let session = Uuid::now_v7();
        let agent = Uuid::now_v7();
        sqlx::query!("INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace, status) VALUES ($1, 'macro|owner@example.com', $2, 'test', 'test', '/workspace', 'disconnected')", session, agent).execute(&pool).await.unwrap();
        let repo = PgCorrelationRepository(pool.clone());
        let first = repo.create(session, agent, None).await.unwrap();
        let second = repo
            .create(session, agent, Some(SessionScope::Generation))
            .await
            .unwrap();
        assert_ne!(first, second);
        assert_eq!(
            repo.find(first).await.unwrap(),
            Some(Correlation {
                session_id: session,
                agent_id: agent,
                scope: None,
            })
        );
        assert_eq!(
            repo.find(second).await.unwrap().unwrap().scope,
            Some(SessionScope::Generation)
        );
        assert!(matches!(
            repo.create(session, Uuid::now_v7(), None).await,
            Err(CorrelationError::AgentMismatch)
        ));
        sqlx::query!("DELETE FROM agent_session WHERE id = $1", session)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(repo.find(first).await.unwrap(), None);
    }
}
