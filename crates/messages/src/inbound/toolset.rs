//! AI tools for the Discussion of every entity that carries one, addressed
//! the way the rest of the system addresses a discussion: by the kind and id
//! of its parent, or by a thread or comment id alone.

mod comment;
mod delete_comment;
mod edit_comment;
mod read_discussion;
mod resolve_comment;

#[cfg(test)]
mod test;

use std::sync::Arc;

use ai_toolset::{AsyncToolCollection, RequestContext, ToolCallError};
use bot_id::BotId;
use entity_access::domain::{
    models::{AccessError, BotAccessScope, EntityAccessReceipt},
    ports::EntityAccessService,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use comment::Comment;
pub use delete_comment::DeleteComment;
pub use edit_comment::EditComment;
pub use read_discussion::ReadDiscussion;
pub use resolve_comment::ResolveComment;

use crate::domain::{
    api::MessageServiceApi,
    models::{InvalidParent, MessageParent},
    ports::MessageError,
    service::{MessageView, MessageWrite},
};

/// Service context for the discussion tools.
pub struct MessageToolContext<ESvc: EntityAccessService> {
    /// Shared message service the tools read and write discussions through.
    pub messages: Arc<dyn MessageServiceApi>,
    /// Mints the capabilities the message service requires.
    pub entity_access_service: Arc<ESvc>,
    /// The bot these tools post as, on behalf of the requesting user.
    /// Defaults to Macro AI; hosts running a specific agent set it with
    /// [`Self::with_actor`].
    pub actor: BotId,
}

impl<ESvc: EntityAccessService> Clone for MessageToolContext<ESvc> {
    fn clone(&self) -> Self {
        Self {
            messages: self.messages.clone(),
            entity_access_service: self.entity_access_service.clone(),
            actor: self.actor,
        }
    }
}

impl<ESvc: EntityAccessService> MessageToolContext<ESvc> {
    /// Create a discussion tool context acting as Macro AI.
    pub fn new(messages: Arc<dyn MessageServiceApi>, entity_access_service: Arc<ESvc>) -> Self {
        Self {
            messages,
            entity_access_service,
            actor: bot_id::MACRO_AI_BOT_ID,
        }
    }

    /// Set the bot these tools act as.
    pub fn with_actor(mut self, actor: BotId) -> Self {
        self.actor = actor;
        self
    }

    /// The requesting user's own view of a discussion.
    async fn discussion_view(
        &self,
        request_context: &RequestContext,
        parent: &MessageParent,
    ) -> Result<EntityAccessReceipt<MessageView>, ToolCallError> {
        self.entity_access_service
            .generate_entity_access_receipt::<MessageView>(
                &request_context.user_id,
                None,
                &parent.entity_id(),
                parent.access_entity_type(),
            )
            .await
            .map_err(access_error(parent, "view"))
    }

    /// The bot's comment capability on a discussion on behalf of the
    /// requesting user: the same comment access the web composer requires.
    async fn discussion_write(
        &self,
        request_context: &RequestContext,
        parent: &MessageParent,
    ) -> Result<EntityAccessReceipt<MessageWrite>, ToolCallError> {
        self.entity_access_service
            .generate_bot_entity_access_receipt::<MessageWrite>(
                self.actor,
                BotAccessScope::user(request_context.user_id.clone()),
                &parent.entity_id(),
                parent.access_entity_type(),
            )
            .await
            .map_err(access_error(parent, "comment"))
    }

    /// The write capability for changing an existing comment as its author:
    /// comments the tool actor bot posted are changed as the bot, and every
    /// other comment as the user, so the message service applies the same
    /// authorship and moderation rules as the web composer.
    async fn comment_author_write(
        &self,
        request_context: &RequestContext,
        parent: &MessageParent,
        comment_id: Uuid,
    ) -> Result<EntityAccessReceipt<MessageWrite>, ToolCallError> {
        let view = self.discussion_view(request_context, parent).await?;
        let comment = self
            .messages
            .get(view, comment_id)
            .await
            .map_err(comment_error("unable to read the comment"))?;
        if comment.sender_id.as_ref() == self.actor.into_storage_id().as_ref() {
            return self.discussion_write(request_context, parent).await;
        }
        self.entity_access_service
            .generate_entity_access_receipt::<MessageWrite>(
                &request_context.user_id,
                None,
                &parent.entity_id(),
                parent.access_entity_type(),
            )
            .await
            .map_err(access_error(parent, "comment"))
    }

    /// The Discussion a comment or thread belongs to, found from its id
    /// alone. Grants nothing: the caller mints the parent's receipt before
    /// reading or writing.
    async fn discussion_of(
        &self,
        id: Uuid,
    ) -> Result<(DiscussionParentType, MessageParent), ToolCallError> {
        let parent = match self.messages.parent_of(id).await {
            Ok(Some(parent)) => parent,
            Ok(None) => {
                return Err(ToolCallError {
                    description: format!("no comment or thread with id {id}"),
                    internal_error: MessageError::NotFound.into(),
                });
            }
            Err(error) => {
                return Err(ToolCallError {
                    description: "unable to look up the comment".to_owned(),
                    internal_error: error.into(),
                });
            }
        };
        match DiscussionParentType::from_parent(&parent) {
            Some(kind) => Ok((kind, parent)),
            None => Err(ToolCallError {
                description: format!(
                    "{id} is a message in a {}, not a Discussion comment; use the channel message tools for it",
                    parent_noun(&parent)
                ),
                internal_error: MessageError::Invalid("message is not a discussion comment").into(),
            }),
        }
    }
}

/// Create the discussion toolset.
pub fn message_toolset<ESvc: EntityAccessService>() -> AsyncToolCollection<MessageToolContext<ESvc>>
{
    AsyncToolCollection::new()
        .add_tool::<ReadDiscussion, MessageToolContext<ESvc>>()
        .add_tool::<Comment, MessageToolContext<ESvc>>()
        .add_tool::<EditComment, MessageToolContext<ESvc>>()
        .add_tool::<DeleteComment, MessageToolContext<ESvc>>()
        .add_tool::<ResolveComment, MessageToolContext<ESvc>>()
}

/// The kinds of item that carry a Discussion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DiscussionParentType {
    /// A document of any type, including tasks, PDFs and uploaded files: the
    /// id in a macro.com/app/<block>/<id> link such as /app/md/<id>,
    /// /app/task/<id> or /app/pdf/<id>.
    Document,
    /// A Tasks project, which the API calls an initiative: the id in a
    /// macro.com/app/tasks/projects/<id> link, the kind ReadInitiative reads.
    /// Not a folder: folders (ReadProject) have no Discussion.
    Initiative,
    /// A CRM company, the kind GetCompany reads.
    CrmCompany,
    /// A CRM contact.
    CrmContact,
}

impl DiscussionParentType {
    /// The parent an item of this kind addresses, from its id.
    fn parent(self, id: &str) -> Result<MessageParent, InvalidParent> {
        let uuid = || id.parse::<Uuid>().map_err(|_| InvalidParent);
        Ok(match self {
            Self::Document => MessageParent::Document(id.to_owned().try_into()?),
            Self::Initiative => MessageParent::Initiative(uuid()?),
            Self::CrmCompany => MessageParent::CrmCompany(uuid()?),
            Self::CrmContact => MessageParent::CrmContact(uuid()?),
        })
    }

    /// The kind of a parent that carries a Discussion; `None` for a channel
    /// or call, whose messages are not comments. Exhaustive on purpose: a new
    /// parent decides here whether the discussion tools address it.
    fn from_parent(parent: &MessageParent) -> Option<Self> {
        match parent {
            MessageParent::Document(_) => Some(Self::Document),
            MessageParent::Initiative(_) => Some(Self::Initiative),
            MessageParent::CrmCompany(_) => Some(Self::CrmCompany),
            MessageParent::CrmContact(_) => Some(Self::CrmContact),
            MessageParent::Channel(_) | MessageParent::Call(_) => None,
        }
    }

    /// The word the application uses for an item of this kind.
    fn noun(self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::Initiative => "project",
            Self::CrmCompany => "company",
            Self::CrmContact => "contact",
        }
    }
}

/// A parent addressed by kind and id, when both were given.
fn parse_target(
    entity_type: Option<DiscussionParentType>,
    entity_id: Option<&str>,
) -> Result<Option<(DiscussionParentType, MessageParent)>, ToolCallError> {
    match (entity_type, entity_id) {
        (None, None) => Ok(None),
        (Some(kind), Some(id)) => {
            kind.parent(id)
                .map(|parent| Some((kind, parent)))
                .map_err(|error| ToolCallError {
                    description: format!("{id} is not a valid {} id", kind.noun()),
                    internal_error: error.into(),
                })
        }
        (Some(_), None) | (None, Some(_)) => Err(ToolCallError {
            description: "entityType and entityId go together: pass both to address an item"
                .to_owned(),
            internal_error: InvalidParent.into(),
        }),
    }
}

/// The word the application uses for a parent, including the ones that
/// carry no Discussion.
fn parent_noun(parent: &MessageParent) -> &'static str {
    match DiscussionParentType::from_parent(parent) {
        Some(kind) => kind.noun(),
        None => match parent {
            MessageParent::Channel(_) => "channel",
            _ => "call",
        },
    }
}

/// `need` is the access the tool spends on the parent: `view` or `comment`.
fn access_error(
    parent: &MessageParent,
    need: &'static str,
) -> impl FnOnce(AccessError) -> ToolCallError {
    let kind = parent_noun(parent);
    let id = parent.entity_id();
    move |error| {
        let description = match &error {
            AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
                format!("you need {need} access to this {kind} to use its Discussion")
            }
            AccessError::NotFound(_) => format!(
                "no {kind} with id {id}; check entityType: a Tasks project is initiative, a task or PDF is document, and a folder has no Discussion"
            ),
            AccessError::BadRequest(_) => format!("{id} is not a valid {kind} id"),
            AccessError::Unavailable(_) | AccessError::Internal(_) => {
                format!("failed to verify access to the {kind}")
            }
        };
        ToolCallError {
            description,
            internal_error: error.into(),
        }
    }
}

fn comment_error(description: &'static str) -> impl FnOnce(MessageError) -> ToolCallError {
    move |error| {
        let description = match &error {
            MessageError::NotFound => {
                "comment thread not found in this item's Discussion".to_owned()
            }
            MessageError::Forbidden => {
                "you need comment access to this item to comment on it".to_owned()
            }
            MessageError::Invalid(reason) => format!("{description}: {reason}"),
            MessageError::Conflict => format!("{description}: message id already exists"),
            MessageError::Repository(_) => description.to_owned(),
        };
        ToolCallError {
            description,
            internal_error: error.into(),
        }
    }
}
