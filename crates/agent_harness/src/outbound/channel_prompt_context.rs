//! Authorized conversation context through the common message application port.

#[cfg(test)]
mod test;

use crate::domain::{
    error::{HarnessError, Result},
    model::{AnnounceOrigin, CommentAnchor, ConversationContext, PriorMessage},
    ports::MessagePromptContext,
};
use entity_access::domain::{
    models::{EntityAccessReceipt, EntityType},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    api::MessageReader,
    models::{MessageParent, ThreadAnchor},
    service::{MessageView, MessageWrite},
};
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
            },
        )
        .await
        .map_err(|error| HarnessError::PromptContext(rootcause::report!(error).into()))
    }
}

/// Reads channel and document conversation history with the same access boundary.
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

    async fn conversation_context(
        &self,
        actor: &MacroUserIdStr<'static>,
        origin: &AnnounceOrigin,
    ) -> Result<ConversationContext> {
        let access = self
            .access
            .capability(actor, &origin.parent)
            .await?
            .try_into_requirement()
            .map_err(|error| HarnessError::PromptContext(rootcause::report!(error).into()))?;
        let messages = self
            .messages
            .preceding(access.clone(), origin.message_id, 10)
            .await
            .map(|messages| {
                messages
                    .into_iter()
                    .map(|m| PriorMessage {
                        sender: m.sender_id.as_ref().to_owned(),
                        content: m.content,
                    })
                    .collect()
            })
            .map_err(|error| HarnessError::PromptContext(rootcause::report!(error).into()))?;
        Ok(ConversationContext {
            anchor: anchor(self.messages.as_ref(), access, origin).await?,
            messages,
        })
    }
}

/// Where a document discussion sits, read from the thread the prompt was posted
/// in. Only documents anchor discussions, so a channel prompt never pays for
/// the lookup.
async fn anchor(
    messages: &dyn MessageReader,
    access: EntityAccessReceipt<MessageView>,
    origin: &AnnounceOrigin,
) -> Result<Option<CommentAnchor>> {
    if !matches!(origin.parent, MessageParent::Document(_)) {
        return Ok(None);
    }
    let thread = messages
        .get_thread(access, origin.thread_id)
        .await
        .map_err(|error| HarnessError::PromptContext(rootcause::report!(error).into()))?;
    Ok(match thread.state.anchor {
        // PDF anchors name an annotation the agent cannot read either, but
        // their text is owned by the annotation rather than the thread.
        Some(ThreadAnchor::Markdown {
            mark_id,
            marked_text,
        }) => Some(CommentAnchor {
            mark_id: mark_id.to_string(),
            marked_text,
        }),
        _ => None,
    })
}
