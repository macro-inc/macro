//! Authorize the origins agent prompts answer into, through the common
//! message application port.

#[cfg(test)]
mod test;

use crate::domain::{
    error::{HarnessError, Result},
    model::AnnounceOrigin,
    ports::MessagePromptContext,
};
use entity_access::domain::{
    models::{EntityAccessReceipt, EntityType},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{api::MessageReader, models::MessageParent, service::MessageWrite};
use std::sync::Arc;

trait ContextAuthorizer: Send + Sync + 'static {
    fn capability(
        &self,
        actor: &MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> impl Future<Output = Result<EntityAccessReceipt<MessageWrite>>> + Send;
}

impl<Access: EntityAccessService> ContextAuthorizer for Access {
    async fn capability(
        &self,
        actor: &MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> Result<EntityAccessReceipt<MessageWrite>> {
        self.generate_entity_access_receipt::<MessageWrite>(
            actor,
            None,
            &parent.entity_id(),
            match parent {
                MessageParent::Channel(_) => EntityType::Channel,
                MessageParent::Document(_) => EntityType::Document,
                MessageParent::Initiative(_) => EntityType::Initiative,
                MessageParent::CrmCompany(_) => EntityType::CrmCompany,
                MessageParent::CrmContact(_) => EntityType::CrmContact,
                MessageParent::Call(_) => EntityType::Call,
            },
        )
        .await
        .map_err(|error| HarnessError::PromptContext(rootcause::report!(error).into()))
    }
}

/// Checks prompt origins with the actor's current access.
pub struct MessagePromptContextAdapter<Access> {
    messages: Arc<dyn MessageReader>,
    access: Arc<Access>,
}

impl<Access> MessagePromptContextAdapter<Access> {
    /// Compose with the shared message service and current entity permissions.
    pub fn new(messages: Arc<dyn MessageReader>, access: Arc<Access>) -> Self {
        Self { messages, access }
    }
}

impl<Access: ContextAuthorizer> MessagePromptContext for MessagePromptContextAdapter<Access> {
    async fn authorize_origin(
        &self,
        actor: &MacroUserIdStr<'static>,
        origin: &AnnounceOrigin,
    ) -> Result<()> {
        let access = self
            .access
            .capability(actor, &origin.parent)
            .await?
            .try_into_requirement()
            .map_err(|error| HarnessError::PromptContext(rootcause::report!(error).into()))?;
        let message = self
            .messages
            .get(access, origin.message_id)
            .await
            .map_err(|error| HarnessError::PromptContext(rootcause::report!(error).into()))?;
        if message.root_id() != origin.thread_id
            || message.parent != origin.parent
            || message.deleted_at.is_some()
        {
            return Err(HarnessError::PromptContext(rootcause::report!(
                "invalid agent message origin"
            )));
        }
        Ok(())
    }
}
