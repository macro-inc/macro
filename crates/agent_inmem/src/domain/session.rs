//! Per-session conversational state, held in memory.
//!
//! The durable record of a session is its frame log; what lives here is only
//! the model-facing conversation the next turn is built from. It survives a
//! reattach within one process lifetime, and a cold attach after a restart
//! rebuilds it from the frame log (see [`crate::domain::replay`]).

use agent::types::{AssistantMessagePart, ChatMessage, ChatMessageContent, Role};
use agent_client_protocol::schema::v1::{ContentBlock, PromptRequest, SessionId};
use agent_runtime_protocol::domain::action::PromptAttachment;
use agent_session::domain::model::AgentSessionId;
use attachment::image::ImageData;
use attachment::{AttachmentContent, AttachmentPart, Attachments};
use dashmap::DashMap;
use model_entity::EntityType;
use non_empty::NonEmpty;

#[cfg(test)]
mod test;

/// What a user said in one turn: the prompt's text, and the files it named.
///
/// Files arrive as ACP `resource_link` blocks - URLs, never bytes. HTTPS
/// images go to the model as image URLs, which the provider fetches itself;
/// anything else is described to the model by name and URL, since there is
/// no way to show it the bytes and the URL is still something its tools can
/// fetch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserPrompt {
    /// The prompt's text blocks, joined.
    pub text: String,
    /// The prompt's `resource_link` blocks, in order.
    pub attachments: Vec<PromptAttachment>,
}

impl UserPrompt {
    /// A prompt of text alone.
    #[must_use]
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            attachments: Vec::new(),
        }
    }

    /// Read a prompt off the content blocks of a `session/prompt`. Block kinds
    /// this agent has no use for (inline images, audio, embedded resources -
    /// none of which it advertises) are skipped.
    #[must_use]
    pub fn from_blocks(blocks: &[ContentBlock]) -> Self {
        let mut prompt = Self::text(String::new());
        for block in blocks {
            match block {
                ContentBlock::Text(text) => prompt.text.push_str(&text.text),
                block => {
                    if let Some(attachment) = PromptAttachment::from_content_block(block) {
                        prompt.attachments.push(attachment);
                    }
                }
            }
        }
        prompt
    }

    /// Read a prompt off a `session/prompt` request.
    #[must_use]
    pub fn from_request(request: &PromptRequest) -> Self {
        Self::from_blocks(&request.prompt)
    }

    /// The model-facing form of the attached files, `None` without any.
    #[must_use]
    pub fn to_attachments(&self) -> Option<Attachments<'static>> {
        let resolved: Vec<_> = self
            .attachments
            .iter()
            .map(|attachment| Ok(attachment_content(attachment)))
            .collect();
        NonEmpty::new(resolved).ok().map(Attachments::new)
    }

    /// The message this prompt is to the model.
    #[must_use]
    pub fn to_chat_message(&self) -> ChatMessage {
        ChatMessage {
            content: ChatMessageContent::Text(self.text.clone()),
            role: Role::User,
            attachments: self.to_attachments(),
        }
    }
}

/// One attached file as resolved attachment content.
///
/// Only an HTTPS image is handed over as an image URL: providers refuse plain
/// HTTP, and history keeps every attachment for the rest of the session, so
/// one such link would fail every later turn. Anything else is named in text.
fn attachment_content(attachment: &PromptAttachment) -> AttachmentContent<'static> {
    let is_image = attachment
        .mime_type
        .as_deref()
        .is_some_and(|mime| mime.starts_with("image/"));
    let fetchable = attachment.uri.starts_with("https://");
    let part = if is_image && fetchable {
        AttachmentPart::Image(ImageData::StaticUrl(attachment.uri.clone()))
    } else {
        let kind = attachment.mime_type.as_deref().unwrap_or("unknown type");
        AttachmentPart::Content(format!(
            "Attached file \"{}\" ({kind}): {}",
            attachment.name, attachment.uri
        ))
    };
    AttachmentContent {
        // The static file id is the URL's last path segment; a URL shaped
        // some other way is identified by the whole URL.
        reference: EntityType::StaticFile.with_entity_string(
            attachment
                .uri
                .rsplit('/')
                .next()
                .filter(|id| !id.is_empty())
                .unwrap_or(&attachment.uri)
                .to_owned(),
        ),
        name: Some(attachment.name.clone()),
        content: NonEmpty::one(part),
    }
}

/// One entry of the conversation, in the shape
/// [`agent::to_rig_messages`] round-trips.
#[derive(Debug, Clone)]
pub enum HistoryEntry {
    /// A prompt from a user.
    User(UserPrompt),
    /// One assistant turn: text, tool calls, and tool results, flattened.
    Assistant(Vec<AssistantMessagePart>),
}

/// The in-memory state of one agent session.
#[derive(Debug)]
pub struct SessionState {
    /// The ACP session id minted by `session/new`, `None` until then.
    pub acp_session_id: Option<SessionId>,
    /// Model id turns run on; `session/set_config_option` moves it.
    pub model: String,
    /// Instructions every turn runs under, snapshotted from the session row
    /// at attach. Nothing moves them: they are the session's system prompt,
    /// and a conversation whose system prompt changed halfway is one the
    /// agent never agreed to.
    pub instructions: Option<String>,
    /// The conversation so far, oldest first.
    pub history: Vec<HistoryEntry>,
}

impl SessionState {
    /// A fresh session on `model` with no conversation yet.
    #[must_use]
    pub fn new(model: String) -> Self {
        Self {
            acp_session_id: None,
            model,
            instructions: None,
            history: Vec::new(),
        }
    }
}

/// Session state by Macro session id, shared between the manager (which
/// creates and tears down entries) and the agent tasks (which read and extend
/// them). Entries outlive individual agent tasks so a reattach keeps its
/// conversation.
pub type SessionStore = DashMap<AgentSessionId, SessionState>;

/// Materialize the conversation for one turn: the recorded history followed
/// by the prompt being answered.
#[must_use]
pub fn messages_for_turn(history: &[HistoryEntry], prompt: &UserPrompt) -> Vec<ChatMessage> {
    history
        .iter()
        .map(|entry| match entry {
            HistoryEntry::User(prompt) => prompt.to_chat_message(),
            HistoryEntry::Assistant(parts) => ChatMessage {
                content: ChatMessageContent::AssistantMessageParts(parts.clone()),
                role: Role::Assistant,
                attachments: None,
            },
        })
        .chain(std::iter::once(prompt.to_chat_message()))
        .collect()
}
