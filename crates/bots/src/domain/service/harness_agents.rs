//! Deleting the agents of a harness that is going away.

use super::*;
use crate::domain::ports::HarnessAgentDeletion;

impl<R: BotRepo, B: MacroEventBroker, C: McpAppCatalog> HarnessAgentDeletion
    for BotServiceImpl<R, B, C>
{
    async fn delete_harness_agents(
        &self,
        actor: MacroUserIdStr<'static>,
        harness: HarnessId,
    ) -> Result<usize, BotError> {
        let deleted = self
            .repo
            .delete_harness_agents(harness)
            .await
            .map_err(|err| BotError::Repo(err.into()))?;

        for (bot_id, owner) in &deleted {
            self.publish_bot_event(&BotMacroEvent::deleted(BotDeletedMetadata {
                bot_id: *bot_id,
                owner: owner.clone(),
                actor_user_id: actor.clone(),
            }));
        }

        Ok(deleted.len())
    }
}
