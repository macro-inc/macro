use channel_sender::ChannelSender;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// A validated document identifier. Historical document ids need not be UUIDs.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub struct DocumentId(String);

impl TryFrom<String> for DocumentId {
    type Error = InvalidParent;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty() || value.trim() != value || value.chars().any(char::is_control) {
            return Err(InvalidParent);
        }
        Ok(Self(value))
    }
}

impl From<DocumentId> for String {
    fn from(value: DocumentId) -> Self {
        value.0
    }
}

/// Invalid or unsupported message parent.
#[derive(Debug, Clone, Copy, thiserror::Error)]
#[error("invalid message parent")]
pub struct InvalidParent;

/// The entity whose permissions and lifecycle govern a message.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", content = "id", rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub enum MessageParent {
    /// A channel, including direct messages.
    Channel(Uuid),
    /// A document, including tasks and PDFs.
    Document(DocumentId),
    /// An internal discussion on a Macro email thread.
    EmailThread(Uuid),
}

impl MessageParent {
    /// Parse a persisted or URL parent reference.
    pub fn parse(entity_type: &str, entity_id: &str) -> Result<Self, InvalidParent> {
        match entity_type {
            "channel" => Ok(Self::Channel(entity_id.parse().map_err(|_| InvalidParent)?)),
            "document" => Ok(Self::Document(entity_id.to_owned().try_into()?)),
            "email_thread" => Ok(Self::EmailThread(
                entity_id.parse().map_err(|_| InvalidParent)?,
            )),
            _ => Err(InvalidParent),
        }
    }

    /// Canonical parent type used in persistence and routes.
    pub fn entity_type(&self) -> &'static str {
        match self {
            Self::Channel(_) => "channel",
            Self::Document(_) => "document",
            Self::EmailThread(_) => "email_thread",
        }
    }

    /// Canonical parent identifier.
    pub fn entity_id(&self) -> String {
        match self {
            Self::Channel(id) | Self::EmailThread(id) => id.to_string(),
            Self::Document(id) => id.0.clone(),
        }
    }

    /// Whether messages are presented as comments on an entity.
    pub fn is_discussion(&self) -> bool {
        !matches!(self, Self::Channel(_))
    }
}

/// A thread's location within its document. Geometry remains annotation-owned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub enum ThreadAnchor {
    /// Stable Lexical mark identity, independent of transient node keys.
    Markdown {
        /// Mark UUID serialized in the document.
        mark_id: Uuid,
    },
    /// An independently existing PDF highlight.
    PdfHighlight {
        /// Highlight annotation UUID.
        anchor_id: Uuid,
    },
    /// A comment-only placeable PDF annotation.
    PdfPlaceable {
        /// Placeable annotation UUID.
        anchor_id: Uuid,
    },
}

/// Location supplied when creating a document discussion.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub enum NewThreadAnchor {
    /// Attach a discussion to a stable Markdown mark.
    Markdown {
        /// Serialized mark identifier.
        mark_id: Uuid,
    },
    /// Attach an independently existing highlight on this document.
    PdfHighlight {
        /// Highlight annotation identifier.
        anchor_id: Uuid,
    },
    /// Atomically create a placeable annotation with the root message.
    PdfPlaceable {
        /// Client-generated annotation identifier used by optimistic rendering.
        anchor_id: Uuid,
        /// PDF page number.
        page: i32,
        /// Horizontal position as a fraction of the page width.
        x_pct: f64,
        /// Vertical position as a fraction of the page height.
        y_pct: f64,
        /// Width as a fraction of the page width.
        width_pct: f64,
        /// Height as a fraction of the page height.
        height_pct: f64,
    },
}

impl NewThreadAnchor {
    /// Thread-owned reference after annotation geometry has been persisted.
    pub fn reference(&self) -> ThreadAnchor {
        match *self {
            Self::Markdown { mark_id } => ThreadAnchor::Markdown { mark_id },
            Self::PdfHighlight { anchor_id } => ThreadAnchor::PdfHighlight { anchor_id },
            Self::PdfPlaceable { anchor_id, .. } => ThreadAnchor::PdfPlaceable { anchor_id },
        }
    }
}

/// State belonging to a whole thread, keyed by its root message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub struct ThreadState {
    /// Root message UUID; there is no separate thread identity.
    pub root_id: Uuid,
    /// User who owns this discussion, including imported discussions.
    pub user_id: String,
    /// Whether this discussion has been resolved.
    pub resolved: bool,
    /// No anchor means a discussion on the entire parent.
    pub anchor: Option<ThreadAnchor>,
    /// Creation time of the discussion.
    pub created_at: DateTime<Utc>,
    /// Last state change.
    pub updated_at: DateTime<Utc>,
    /// Explicit deletion of the entire thread, distinct from root deletion.
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Display attribution for a comment imported from an external document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub struct ImportedAuthor {
    /// Original author text; never interpreted as an authenticated principal.
    pub name: String,
}

/// Reaction emoji and the users who added it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub struct CountedReaction {
    /// Emoji being reacted with.
    pub emoji: String,
    /// User identifiers.
    pub users: Vec<String>,
}

/// An entity attached to a message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub struct MessageAttachment {
    /// Attachment UUID.
    pub id: Uuid,
    /// Attached entity type.
    pub entity_type: String,
    /// Attached entity identifier.
    pub entity_id: String,
    /// Optional media width.
    pub width: Option<i32>,
    /// Optional media height.
    pub height: Option<i32>,
    /// When the attachment was added.
    pub created_at: DateTime<Utc>,
}

/// An attachment to add to a message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub struct NewAttachment {
    /// Attached entity type.
    pub entity_type: String,
    /// Attached entity identifier.
    pub entity_id: String,
    /// Optional media width.
    pub width: Option<i32>,
    /// Optional media height.
    pub height: Option<i32>,
}

/// A mention tracked in a message body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub struct SimpleMention {
    /// Mentioned entity type.
    pub entity_type: String,
    /// Mentioned entity identifier.
    pub entity_id: String,
}

impl SimpleMention {
    /// Construct a tracked mention of a Macro user.
    pub fn user(user_id: &macro_user_id::user_id::MacroUserIdStr<'_>) -> Self {
        Self {
            entity_type: "user".to_string(),
            entity_id: user_id.as_ref().to_string(),
        }
    }
}

impl std::fmt::Display for SimpleMention {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}", self.entity_type, self.entity_id)
    }
}

/// Shared message representation for channel timelines and entity discussions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub struct Message {
    /// Message UUID.
    pub id: Uuid,
    /// Entity that owns this conversation.
    pub parent: MessageParent,
    /// Root message UUID for replies; absent on roots.
    pub thread_id: Option<Uuid>,
    /// Authenticated actor or owner of imported content.
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    #[cfg_attr(feature = "json-schema", schemars(with = "String"))]
    pub sender_id: ChannelSender<'static>,
    /// Original external author, when imported.
    pub imported_author: Option<ImportedAuthor>,
    /// User who triggered a bot-authored message.
    pub triggered_by: Option<String>,
    /// Macro Markdown body.
    pub content: String,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Last persisted update.
    pub updated_at: DateTime<Utc>,
    /// Last content edit, if any.
    pub edited_at: Option<DateTime<Utc>>,
    /// Message tombstone, independent of thread deletion.
    pub deleted_at: Option<DateTime<Utc>>,
    /// Attached entities.
    pub attachments: Vec<MessageAttachment>,
    /// Aggregated reactions.
    pub reactions: Vec<CountedReaction>,
}

impl Message {
    /// Canonical thread identity for roots and replies alike.
    pub fn root_id(&self) -> Uuid {
        self.thread_id.unwrap_or(self.id)
    }
}

/// A discussion with its root and ordered replies, including root tombstones.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub struct MessageThread {
    /// Shared thread lifecycle and anchor state.
    pub state: ThreadState,
    /// Root message, which may be a tombstone.
    pub root: Message,
    /// Replies in display order.
    pub replies: Vec<Message>,
}

/// Create a root or reply. Thread state may only be supplied on a root.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub struct PostMessage {
    /// Macro Markdown body.
    pub content: String,
    /// Root to reply to, if this is a reply.
    pub thread_id: Option<Uuid>,
    /// Optional document location for a new discussion.
    pub anchor: Option<NewThreadAnchor>,
    /// Mentions tracked by the editor.
    #[serde(default)]
    pub mentions: Vec<SimpleMention>,
    /// Initial attachments.
    #[serde(default)]
    pub attachments: Vec<NewAttachment>,
    /// Client nonce for optimistic reconciliation.
    pub nonce: Option<String>,
}
