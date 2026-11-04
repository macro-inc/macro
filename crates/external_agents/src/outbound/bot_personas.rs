//! External agent personas, as the bots domain keeps them.

use bot_id::BotId;
use bots::domain::{
    models::{Agent, CreateAgentRequest, CreateBotTokenRequest},
    ports::{BotError, BotService},
};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::ports::{AgentPersonas, ExternalAgentError, Result};

/// Label of the bot tokens minted for an external agent's runtime.
const EXTERNAL_AGENT_TOKEN_LABEL: &str = "External agent";

fn persona_error(error: BotError) -> ExternalAgentError {
    match error {
        BotError::BadRequest(message) => ExternalAgentError::BadRequest(message),
        BotError::NotFound(_) => ExternalAgentError::NotFound,
        BotError::Unauthorized => ExternalAgentError::Unauthorized,
        BotError::Unavailable(message) => {
            ExternalAgentError::Internal(rootcause::report!("{message}"))
        }
        BotError::Repo(error) => ExternalAgentError::Internal(rootcause::report!("{error:#}")),
    }
}

/// [`AgentPersonas`] over the bots domain service.
#[derive(Clone)]
pub struct BotServicePersonas<B>(pub B);

impl<B: BotService> AgentPersonas for BotServicePersonas<B> {
    async fn create(
        &self,
        caller: MacroUserIdStr<'static>,
        req: CreateAgentRequest,
    ) -> Result<Agent> {
        self.0.create_agent(caller, req).await.map_err(persona_error)
    }

    async fn manageable(&self, caller: MacroUserIdStr<'static>, bot_id: BotId) -> Result<Agent> {
        self.0
            .manageable_agent(caller, bot_id)
            .await
            .map_err(persona_error)
    }

    async fn list(&self, caller: MacroUserIdStr<'static>) -> Result<Vec<Agent>> {
        self.0.list_agents(caller).await.map_err(persona_error)
    }

    async fn delete(&self, caller: MacroUserIdStr<'static>, bot_id: BotId) -> Result<()> {
        self.0.delete_bot(caller, bot_id).await.map_err(persona_error)
    }

    async fn issue_token(&self, caller: MacroUserIdStr<'static>, bot_id: BotId) -> Result<String> {
        self.0
            .create_token(
                caller,
                bot_id,
                CreateBotTokenRequest {
                    label: Some(EXTERNAL_AGENT_TOKEN_LABEL.to_owned()),
                    expires_at: None,
                },
            )
            .await
            .map(|created| created.bearer_token)
            .map_err(persona_error)
    }
}
