//! Correlation storage contract and validation, separate from authorization.

use async_trait::async_trait;
use uuid::Uuid;

/// The session and its bound agent, resolved from durable state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Correlation {
    /// Originating agent session.
    pub session_id: Uuid,
    /// Agent bound to that session.
    pub agent_id: Uuid,
}

/// Durable mappings owned by agent correlation.
#[async_trait]
pub trait CorrelationRepository: Send + Sync {
    /// Record a fresh invocation only if the session belongs to the given agent.
    async fn create(&self, session: Uuid, agent: Uuid) -> Result<Uuid, CorrelationError>;
    /// Resolve the invocation and the session's bound agent, without a state check.
    async fn find(&self, id: Uuid) -> Result<Option<Correlation>, CorrelationError>;
}

/// Invalid attribution or an unavailable attribution store.
#[derive(Debug, thiserror::Error)]
pub enum CorrelationError {
    /// Signed correlation must also identify the executing agent.
    #[error("agent_correlation_id requires a signed agent_id")]
    MissingAgent,
    /// The mapping or its session no longer exists.
    #[error("agent_correlation_id does not identify an agent session")]
    NotFound,
    /// The signed agent does not match the session's agent.
    #[error("agent_correlation_id belongs to a different agent")]
    AgentMismatch,
    /// Storage failure; never report as invalid caller input.
    #[error("agent correlation storage is unavailable")]
    Unavailable(rootcause::Report),
}

/// Validate attribution without changing the request's acting user or access.
#[tracing::instrument(skip(repository), err)]
pub async fn validate<R: CorrelationRepository + ?Sized>(
    repository: &R,
    id: Uuid,
    agent: Option<Uuid>,
) -> Result<Correlation, CorrelationError> {
    let agent = agent.ok_or(CorrelationError::MissingAgent)?;
    let correlation = repository
        .find(id)
        .await?
        .ok_or(CorrelationError::NotFound)?;
    if correlation.agent_id != agent {
        return Err(CorrelationError::AgentMismatch);
    }
    Ok(correlation)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Repository(Option<Correlation>);

    #[async_trait]
    impl CorrelationRepository for Repository {
        async fn create(&self, _: Uuid, _: Uuid) -> Result<Uuid, CorrelationError> {
            unreachable!()
        }
        async fn find(&self, _: Uuid) -> Result<Option<Correlation>, CorrelationError> {
            Ok(self.0)
        }
    }

    #[tokio::test]
    async fn attribution_requires_an_existing_mapping_for_the_signed_agent() {
        let correlation = Correlation {
            session_id: Uuid::now_v7(),
            agent_id: Uuid::now_v7(),
        };
        let repo = Repository(Some(correlation));
        let id = Uuid::now_v7();
        assert_eq!(
            validate(&repo, id, Some(correlation.agent_id))
                .await
                .unwrap(),
            correlation
        );
        assert!(matches!(
            validate(&repo, id, None).await,
            Err(CorrelationError::MissingAgent)
        ));
        assert!(matches!(
            validate(&repo, id, Some(Uuid::now_v7())).await,
            Err(CorrelationError::AgentMismatch)
        ));
        assert!(matches!(
            validate(&Repository(None), id, Some(correlation.agent_id)).await,
            Err(CorrelationError::NotFound)
        ));
    }
}
