//! Owner-checked permanent delete of a chat, for callers removing an owner.

#[cfg(test)]
mod test;

use super::ChatServiceImpl;
use crate::domain::{
    models::ChatErr,
    ports::{ChatRepo, ChatService},
};
use entity_access::domain::models::EntityAccessReceipt;
use entity_access_management::domain::ports::EntityAccessManagementService;
use macro_event_broker::MacroEventBroker;
use model_entity::EntityType;
use model_owner::Owner;
use rootcause::{Report, prelude::*};
use shared_entity_registry::{OwnedPurgeOutcome, PurgeOwnedEntity};

impl<R: ChatRepo, ToolSetContext, Eam: EntityAccessManagementService, B: MacroEventBroker>
    PurgeOwnedEntity for ChatServiceImpl<R, ToolSetContext, Eam, B>
where
    ToolSetContext: Clone + Send + Sync + 'static,
{
    #[tracing::instrument(
        skip(self, expected_owner),
        fields(expected_owner.kind = ?expected_owner.owner_type()),
        err
    )]
    async fn purge_owned(
        &self,
        entity_id: uuid::Uuid,
        expected_owner: &Owner,
    ) -> Result<OwnedPurgeOutcome, Report> {
        let chat_id = entity_id.to_string();
        let chat = match self.repo.get_metadata(&chat_id).await {
            Err(ChatErr::NotFound) => return Ok(OwnedPurgeOutcome::Purged),
            loaded => loaded.context("unable to look up the chat")?,
        };
        if chat.user_id != *expected_owner {
            return Ok(OwnedPurgeOutcome::OwnedElsewhere);
        }
        self.permanently_delete(EntityAccessReceipt::dangerously_assert_internal_user(
            &chat_id,
            EntityType::Chat,
        ))
        .await
        .context("unable to permanently delete the chat")?;
        Ok(OwnedPurgeOutcome::Purged)
    }
}
