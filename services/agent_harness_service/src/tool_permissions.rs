//! Composition-root adapters for `agent_permissions`: who may edit an agent
//! comes from the bots service's own rule, and a session's agent and owner
//! from the session repo, so neither domain crate depends on the other.

use agent_permissions::domain::model::{AgentAccess, SessionFacts};
use agent_permissions::domain::ports::{AgentDirectory, SessionDirectory};
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::{AgentSessionId, session_owner_user};
use agent_session::domain::ports::AgentSessionRepo;
use bot_id::BotId;
use bots::domain::ports::{BotError, BotService};
use macro_user_id::user_id::MacroUserIdStr;

/// [`AgentDirectory`] over the bots service: whoever may edit the agent
/// (`manageable_agent`) may edit its permissions.
pub struct BotsAgentDirectory<Bots>(pub Bots);

/// The bots service could not tell.
#[derive(Debug, thiserror::Error)]
#[error("could not look up the agent: {0}")]
pub struct AgentLookupError(String);

impl<Bots: BotService + Send + Sync + 'static> AgentDirectory for BotsAgentDirectory<Bots> {
    type Err = AgentLookupError;

    async fn access(
        &self,
        user: &MacroUserIdStr<'static>,
        agent: BotId,
    ) -> Result<AgentAccess, AgentLookupError> {
        match self.0.manageable_agent(user.clone(), agent).await {
            Ok(_) => Ok(AgentAccess::Manageable),
            Err(BotError::Unauthorized) => Ok(AgentAccess::NotManageable),
            Err(BotError::NotFound(_)) => Ok(AgentAccess::NotFound),
            Err(error) => Err(AgentLookupError(error.to_string())),
        }
    }
}

/// [`SessionDirectory`] over the agent session repo.
pub struct RepoSessionDirectory<Repo>(pub Repo);

impl<Repo: AgentSessionRepo> SessionDirectory for RepoSessionDirectory<Repo> {
    type Err = AgentSessionError;

    async fn facts(
        &self,
        session: AgentSessionId,
    ) -> Result<Option<SessionFacts>, AgentSessionError> {
        let Some(session) = self.0.find(session).await? else {
            return Ok(None);
        };
        Ok(Some(SessionFacts {
            agent: session.bot_id,
            owner: session_owner_user(&session.owner_id)?,
        }))
    }
}
