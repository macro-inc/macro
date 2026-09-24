//! Authorized conversation context through the common message application port.

#[cfg(test)]
mod test;

use crate::domain::{
    error::{HarnessError, Result},
    model::{AnnounceOrigin, CommentAnchor, ConversationContext, MarkedPassage, PriorMessage},
    ports::MessagePromptContext,
};
use entity_access::domain::{
    models::{EntityAccessReceipt, EntityType},
    ports::EntityAccessService,
};
use lexical_client::LexicalClient;
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

/// Reads what a comment mark covers in the live document. It checks no access
/// of its own: it is only asked after the thread was read under the actor's
/// capability on that document.
trait MarkReader: Send + Sync + 'static {
    fn resolve(
        &self,
        document_id: &str,
        mark_id: &str,
    ) -> impl Future<Output = anyhow::Result<Option<MarkedPassage>>> + Send;
}

impl MarkReader for LexicalClient {
    async fn resolve(
        &self,
        document_id: &str,
        mark_id: &str,
    ) -> anyhow::Result<Option<MarkedPassage>> {
        Ok(self
            .resolve_comment_mark(document_id, mark_id)
            .await?
            .map(|mark| MarkedPassage {
                marked_text: mark.marked_text,
                surrounding_text: mark.surrounding_text,
            }))
    }
}

/// Reads channel and document conversation history with the same access boundary.
pub struct MessagePromptContextAdapter<Access, Marks = LexicalClient> {
    messages: Arc<dyn MessageReader>,
    access: Arc<Access>,
    marks: Arc<Marks>,
}

impl<Access, Marks> MessagePromptContextAdapter<Access, Marks> {
    /// Compose with the shared message service, current entity permissions,
    /// and the live documents comment marks are resolved against.
    pub fn new(messages: Arc<dyn MessageReader>, access: Arc<Access>, marks: Arc<Marks>) -> Self {
        Self {
            messages,
            access,
            marks,
        }
    }
}

impl<Access: ContextAuthorizer, Marks: MarkReader> MessagePromptContext
    for MessagePromptContextAdapter<Access, Marks>
{
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
            anchor: anchor(self.messages.as_ref(), self.marks.as_ref(), access, origin).await?,
            messages,
        })
    }
}

/// Where a document discussion sits, read from the thread the prompt was posted
/// in, and what that mark covers in the document now. Only documents anchor
/// discussions, so a channel prompt never pays for the lookup. A failed live
/// lookup leaves the stored snapshot to stand in rather than failing the prompt.
async fn anchor(
    messages: &dyn MessageReader,
    marks: &impl MarkReader,
    access: EntityAccessReceipt<MessageView>,
    origin: &AnnounceOrigin,
) -> Result<Option<CommentAnchor>> {
    let MessageParent::Document(document) = &origin.parent else {
        return Ok(None);
    };
    let thread = messages
        .get_thread(access, origin.thread_id)
        .await
        .map_err(|error| HarnessError::PromptContext(rootcause::report!(error).into()))?;
    // PDF anchors name an annotation the agent cannot read either, but their
    // text is owned by the annotation rather than the thread.
    let Some(ThreadAnchor::Markdown {
        mark_id,
        marked_text,
    }) = thread.state.anchor
    else {
        return Ok(None);
    };
    let mark_id = mark_id.to_string();
    let current = marks
        .resolve(&origin.parent.entity_id(), &mark_id)
        .await
        .inspect_err(|error| {
            tracing::warn!(
                error = ?error,
                document = ?document,
                %mark_id,
                "sending comment anchor without the live marked text"
            );
        })
        .ok()
        .flatten();
    Ok(Some(CommentAnchor {
        mark_id,
        marked_text,
        current,
    }))
}
