//! Authorized conversation context through the common message application port.

#[cfg(test)]
mod test;

use crate::domain::{
    error::{HarnessError, Result},
    model::{
        AnnounceOrigin, CommentAnchor, ContextMessage, ContextThread, ConversationContext,
        MarkedPassage, ReplyTarget,
    },
    ports::MessagePromptContext,
};
use entity_access::domain::{
    models::{EntityAccessReceipt, EntityType},
    ports::EntityAccessService,
};
use lexical_client::LexicalClient;
use lexical_client::parse_markdown::ExtractedExplicitReply;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use messages::domain::{
    api::MessageReader,
    models::{Message, MessageParent, MessageThread, ThreadAnchor},
    service::{MessageView, MessageWrite},
};
use std::sync::Arc;

/// Channel messages before the prompt read as the surrounding activity.
const CHANNEL_MESSAGES: u16 = 10;

/// Most messages of the prompt's own discussion carried. The root is always
/// kept, so a long thread loses its middle rather than its subject.
const THREAD_MESSAGES: usize = 50;

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

/// Reads the message a prompt quote-replies to out of the prompt's markdown.
/// The quoted message itself is read separately, under the actor's access.
trait QuoteReader: Send + Sync + 'static {
    fn quoted(
        &self,
        markdown: &str,
    ) -> impl Future<Output = anyhow::Result<Option<ExtractedExplicitReply>>> + Send;
}

impl QuoteReader for LexicalClient {
    async fn quoted(&self, markdown: &str) -> anyhow::Result<Option<ExtractedExplicitReply>> {
        self.extract_explicit_reply(markdown).await
    }
}

/// Reads channel and document conversation history with the same access boundary.
pub struct MessagePromptContextAdapter<Access, Lexical = LexicalClient> {
    messages: Arc<dyn MessageReader>,
    access: Arc<Access>,
    lexical: Arc<Lexical>,
}

impl<Access, Lexical> MessagePromptContextAdapter<Access, Lexical> {
    /// Compose with the shared message service, current entity permissions,
    /// and the lexical service that resolves comment marks and quotes.
    pub fn new(
        messages: Arc<dyn MessageReader>,
        access: Arc<Access>,
        lexical: Arc<Lexical>,
    ) -> Self {
        Self {
            messages,
            access,
            lexical,
        }
    }
}

fn context_error(error: impl std::fmt::Display) -> HarnessError {
    HarnessError::PromptContext(rootcause::report!(error.to_string()).into())
}

impl<Access: ContextAuthorizer, Lexical: MarkReader + QuoteReader> MessagePromptContext
    for MessagePromptContextAdapter<Access, Lexical>
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

    /// The prompt's own discussion is read whole, because that is what the
    /// prompt is about. Nearby channel messages are grouped by the discussion
    /// they belong to so the agent can tell them apart from it.
    async fn conversation_context(
        &self,
        actor: &MacroUserIdStr<'static>,
        origin: &AnnounceOrigin,
    ) -> Result<ConversationContext> {
        let access: EntityAccessReceipt<MessageView> = self
            .access
            .capability(actor, &origin.parent)
            .await?
            .try_into_requirement()
            .map_err(|error| HarnessError::PromptContext(rootcause::report!(error).into()))?;
        let prompt = self
            .messages
            .get(access.clone(), origin.message_id)
            .await
            .map_err(context_error)?;
        let is_channel = matches!(origin.parent, MessageParent::Channel(_));
        let top_level = is_channel && origin.thread_id == origin.message_id;

        let discussion = if top_level {
            None
        } else {
            Some(
                self.messages
                    .get_thread(access.clone(), origin.thread_id)
                    .await
                    .map_err(context_error)?,
            )
        };
        let recent = if is_channel {
            self.messages
                .preceding(access.clone(), origin.message_id, CHANNEL_MESSAGES)
                .await
                .map_err(context_error)?
        } else {
            Vec::new()
        };

        let anchor = match (&origin.parent, &discussion) {
            (MessageParent::Document(_), Some(discussion)) => {
                anchor(
                    self.lexical.as_ref(),
                    origin,
                    discussion.state.anchor.clone(),
                )
                .await
            }
            _ => None,
        };
        let reply_target = match quote(
            self.messages.as_ref(),
            self.lexical.as_ref(),
            origin,
            &prompt,
            access,
        )
        .await
        {
            Some(quote) => quote,
            None if top_level => ReplyTarget::None,
            None => ReplyTarget::Thread {
                root_id: origin.thread_id,
            },
        };

        let mut channel = channel_threads(&recent, origin.thread_id);
        if top_level {
            channel.push(ContextThread {
                root_id: prompt.id,
                messages: context_message(&prompt).into_iter().collect(),
                messages_omitted: false,
            });
        }

        Ok(ConversationContext {
            anchor,
            reply_target: Some(reply_target),
            prompt_message_id: Some(prompt.id),
            thread: discussion.map(|discussion| prompt_thread(discussion, &prompt)),
            channel,
        })
    }
}

/// Where a document discussion sits, and what that anchor covers now. A PDF
/// highlight's text arrives with the thread; a markdown mark is resolved
/// against the live document, and a failed lookup leaves the stored
/// snapshot to stand in rather than failing the prompt.
async fn anchor(
    lexical: &impl MarkReader,
    origin: &AnnounceOrigin,
    anchor: Option<ThreadAnchor>,
) -> Option<CommentAnchor> {
    let (mark_id, marked_text) = match anchor? {
        ThreadAnchor::PdfHighlight {
            anchor_id,
            marked_text,
        } => {
            return Some(CommentAnchor::PdfHighlight {
                anchor_id: anchor_id.to_string(),
                marked_text,
            });
        }
        ThreadAnchor::PdfPlaceable { anchor_id } => {
            return Some(CommentAnchor::PdfPin {
                anchor_id: anchor_id.to_string(),
            });
        }
        ThreadAnchor::Markdown {
            mark_id,
            marked_text,
        } => (mark_id.to_string(), marked_text),
    };
    let current = lexical
        .resolve(&origin.parent.entity_id(), &mark_id)
        .await
        .inspect_err(|error| {
            tracing::warn!(
                error = ?error,
                parent = ?origin.parent,
                %mark_id,
                "sending comment anchor without the live marked text"
            );
        })
        .ok()
        .flatten();
    Some(CommentAnchor::Mark {
        mark_id,
        marked_text,
        current,
    })
}

/// The message the prompt quote-replies to, when it is one. The quoted
/// message is only read when it sits in the prompt's own conversation,
/// which the actor's access already covers; a quote from elsewhere
/// travels as its preview.
async fn quote(
    messages: &dyn MessageReader,
    lexical: &impl QuoteReader,
    origin: &AnnounceOrigin,
    prompt: &Message,
    access: EntityAccessReceipt<MessageView>,
) -> Option<ReplyTarget> {
    let quoted = lexical
        .quoted(&prompt.content)
        .await
        .inspect_err(|error| {
            tracing::warn!(
                error = ?error,
                message_id = %origin.message_id,
                "sending agent prompt without its quote-reply target"
            );
        })
        .ok()
        .flatten()?;
    let (Ok(message_id), Ok(thread_id)) = (
        Uuid::parse_str(&quoted.target_message_id),
        Uuid::parse_str(&quoted.target_thread_id),
    ) else {
        tracing::warn!(
            target_message_id = %quoted.target_message_id,
            target_thread_id = %quoted.target_thread_id,
            "quote-reply target is not a message id"
        );
        return None;
    };
    let message = if quoted.parent == origin.parent {
        messages
            .get(access, message_id)
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, %message_id, "quoted message is unreadable");
            })
            .ok()
            .filter(|message| message.deleted_at.is_none() && message.parent == origin.parent)
            .and_then(|message| context_message(&message))
    } else {
        None
    };
    Some(ReplyTarget::Quote {
        message_id,
        thread_id,
        preview: quoted.display_text,
        message,
    })
}

/// The prompt's discussion from its root through the prompt. Replies posted
/// after the prompt belong to later turns and are left out.
fn prompt_thread(discussion: MessageThread, prompt: &Message) -> ContextThread {
    let root_id = discussion.state.root_id;
    let mut messages = Vec::new();
    let mut reached_prompt = false;
    for message in std::iter::once(discussion.root).chain(discussion.replies) {
        let is_prompt = message.id == prompt.id;
        if message.deleted_at.is_none()
            && let Some(message) = context_message(&message)
        {
            messages.push(message);
        }
        if is_prompt {
            reached_prompt = true;
            break;
        }
    }
    if !reached_prompt && let Some(message) = context_message(prompt) {
        messages.push(message);
    }

    let messages_omitted = messages.len() > THREAD_MESSAGES;
    if messages_omitted {
        let keep_root = messages
            .first()
            .is_some_and(|message| message.id == root_id);
        let tail = messages.split_off(messages.len() - (THREAD_MESSAGES - usize::from(keep_root)));
        messages.truncate(usize::from(keep_root));
        messages.extend(tail);
    }
    ContextThread {
        root_id,
        messages,
        messages_omitted,
    }
}

/// Channel messages outside the prompt's discussion, grouped by the
/// discussion each belongs to, in the order the discussions first appear.
fn channel_threads(recent: &[Message], prompt_root: Uuid) -> Vec<ContextThread> {
    let mut threads: Vec<ContextThread> = Vec::new();
    for message in recent {
        let root_id = message.root_id();
        if message.deleted_at.is_some() || root_id == prompt_root {
            continue;
        }
        let Some(entry) = context_message(message) else {
            continue;
        };
        match threads.iter_mut().find(|thread| thread.root_id == root_id) {
            Some(thread) => thread.messages.push(entry),
            None => threads.push(ContextThread {
                root_id,
                // A reply whose root fell outside the window.
                messages_omitted: message.id != root_id,
                messages: vec![entry],
            }),
        }
    }
    threads
}

/// A live message as context; `None` when its body is blank.
fn context_message(message: &Message) -> Option<ContextMessage> {
    let content = message.content.trim();
    (!content.is_empty()).then(|| ContextMessage {
        id: message.id,
        sender_id: message.sender_id.as_ref().to_owned(),
        author: author(message),
        content: content.to_owned(),
        posted_at: message.created_at,
    })
}

/// Who wrote a message, as a reader would name them.
fn author(message: &Message) -> String {
    if let Some(imported) = &message.imported_author {
        return imported.name.clone();
    }
    if let Some(bot) = &message.bot_profile {
        return bot.name.clone();
    }
    message.sender_id.as_user().map_or_else(
        || message.sender_id.as_ref().to_owned(),
        |user| user.email_str().to_owned(),
    )
}
