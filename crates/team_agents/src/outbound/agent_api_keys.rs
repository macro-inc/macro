//! The agent's own API key, minted with the user API key service.

use std::sync::Arc;

use macro_user_id::user_id::MacroUserIdStr;
use user_api_key::domain::{models::UserApiKeyError, ports::UserApiKeyService};

use crate::domain::models::{AgentApiKey, TeamAgentError};
use crate::domain::ports::AgentApiKeys;

/// Name the key shows under in the agent's Settings → API Keys.
const BRAIN_KEY_NAME: &str = "Brain";

/// Mints agents' keys with the user API key service.
pub struct UserApiKeys<S> {
    service: Arc<S>,
}

impl<S> UserApiKeys<S> {
    /// Wraps the user API key service.
    pub fn new(service: Arc<S>) -> Self {
        Self { service }
    }
}

impl<S: UserApiKeyService> AgentApiKeys for UserApiKeys<S> {
    #[tracing::instrument(skip_all, err)]
    async fn revoke_all(&self, agent_user_id: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        let keys = self
            .service
            .list_keys(agent_user_id)
            .await
            .map_err(TeamAgentError::internal)?;
        for key in keys {
            match self.service.delete_key(agent_user_id, key.id).await {
                // Gone already: revoked by someone else in the meantime.
                Ok(()) | Err(UserApiKeyError::NotFound) => {}
                Err(error) => return Err(TeamAgentError::internal(error)),
            }
        }
        Ok(())
    }

    async fn mint(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<AgentApiKey, TeamAgentError> {
        let created = self
            .service
            .replace_key(agent_user_id, BRAIN_KEY_NAME)
            .await
            .map_err(TeamAgentError::internal)?;

        AgentApiKey::parse(created.key).map_err(TeamAgentError::internal)
    }
}
