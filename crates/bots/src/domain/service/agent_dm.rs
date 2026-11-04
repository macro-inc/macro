//! Persona eligibility for private user-agent conversations.

use super::*;
use crate::domain::ports::AgentDmEligibility;

impl<R: BotRepo, B: MacroEventBroker, C: McpAppCatalog> AgentDmEligibility
    for BotServiceImpl<R, B, C>
{
    async fn authorize_agent_dm(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> Result<(), BotError> {
        if let Some(bot) = bot_id::system_bot(bot_id) {
            return if bot.has_agent {
                Ok(())
            } else {
                Err(BotError::Unauthorized)
            };
        }
        let bot = self.ensure_manageable(caller, bot_id).await?;
        if !bot.has_agent
            || self
                .repo
                .get_agent(bot_id)
                .await
                .map_err(|error| BotError::Repo(error.into()))?
                .is_none()
        {
            return Err(BotError::Unauthorized);
        }
        Ok(())
    }
}
