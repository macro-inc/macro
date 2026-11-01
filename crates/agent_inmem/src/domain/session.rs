//! Per-session conversational state, held in memory.
//!
//! The durable record of a session is its frame log; what lives here is only
//! the model-facing conversation the next turn is built from. It survives a
//! reattach within one process lifetime, and a cold attach after a restart
//! rebuilds it from the frame log (see [`crate::domain::replay`]).

use std::collections::HashMap;

use agent::ReasoningEffort;
use agent::types::{AssistantMessagePart, ChatMessage, ChatMessageContent, Role};
use agent_client_protocol::schema::v1::{ContentBlock, PromptRequest, RequestId, SessionId};
use agent_runtime_protocol::domain::action::PromptAttachment;
use agent_session::domain::model::AgentSessionId;
use attachment::image::ImageData;
use attachment::{AttachmentContent, AttachmentPart, Attachments};
use dashmap::DashMap;
use model_entity::EntityType;
use non_empty::NonEmpty;
use tokio_util::sync::CancellationToken;

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

    /// The attached files that reach the model as images: HTTPS images,
    /// which the provider fetches. Any other file is named in text.
    pub fn images(&self) -> impl Iterator<Item = &PromptAttachment> {
        self.attachments
            .iter()
            .filter(|attachment| is_image(attachment) && attachment.uri.starts_with("https://"))
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

/// The image file extensions the composer's chips classify as images, so a
/// file the user sees as a thumbnail is one the model sees as an image. Keep
/// in step with `CHANNEL_IMAGE_FILE_EXTENSIONS` on the web side.
const IMAGE_EXTENSIONS: &[&str] = &[
    "apng", "avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "svg", "tif", "tiff",
    "webp",
];

/// The media type browsers give `.psd` and `.psb` files.
const PHOTOSHOP_MIME: &str = "image/vnd.adobe.photoshop";

/// Whether this file is an image, by media type and then by name.
///
/// A browser can report no media type at all for a `.png`, and the composer
/// still shows it as a thumbnail, so the name decides when the type cannot.
fn is_image(attachment: &PromptAttachment) -> bool {
    let mime = attachment.mime_type.as_deref().unwrap_or_default();
    // Photoshop documents carry an image media type, but they are layered
    // design files no image pipeline decodes: they are named in text.
    if mime == PHOTOSHOP_MIME {
        return false;
    }
    if mime.starts_with("image/") {
        return true;
    }
    // Mirrors the composer's own order: a media type naming another medium
    // wins, and otherwise the name decides.
    if mime.starts_with("video/") {
        return false;
    }
    attachment
        .name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .is_some_and(|extension| IMAGE_EXTENSIONS.contains(&extension.as_str()))
}

/// One attached file as resolved attachment content.
///
/// Only an HTTPS image is handed over as an image URL: providers refuse plain
/// HTTP, and history keeps every attachment for the rest of the session, so
/// one such link would fail every later turn. Anything else is named in text.
fn attachment_content(attachment: &PromptAttachment) -> AttachmentContent<'static> {
    let is_image = is_image(attachment);
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
    let mut content = NonEmpty::one(part);
    if is_image && fetchable {
        // The model conversion emits content parts, not AttachmentContent's
        // name/reference fields. Keep the source visible even when a local
        // adapter replaces the image URL with inline bytes, so tools can reuse
        // an uploaded reference. This describes any image URL without claiming
        // that a third-party image is a Macro static file.
        content.push(AttachmentPart::Metadata {
            key: "image_file_name".to_owned(),
            value: attachment.name.clone(),
        });
        content.push(AttachmentPart::Metadata {
            key: "image_source_uri".to_owned(),
            value: attachment.uri.clone(),
        });
    }
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
        content,
    }
}

use super::engine::AgentIdentity;

/// One entry of the conversation, in the shape
/// [`agent::to_rig_messages`] round-trips.
#[derive(Debug, Clone)]
pub enum HistoryEntry {
    /// A prompt from a user.
    User {
        /// What they said.
        prompt: UserPrompt,
        /// The JSON-RPC id of the `session/prompt` request it came in. The
        /// log keeps the request whole, so the live agent and a replay of
        /// its log know the turn by the same id even where their entries
        /// differ, and a summary names the last turn it covers by it.
        request_id: RequestId,
    },
    /// One assistant turn: text, tool calls, and tool results, flattened.
    Assistant(Vec<AssistantMessagePart>),
    /// What a summary says of the conversation before it, which it stands
    /// in for. The model reads it as history it has already acted on.
    Summary(String),
}

/// What the model reads ahead of a summary, so it takes the summary as what
/// already happened rather than as work to do, and knows where the exact
/// words went.
pub const SUMMARY_PREAMBLE: &str = "The earlier conversation was summarized to keep it within \
your context. The summary below is history: the actions it records already happened, so do \
not repeat them. ContentSearch over this agent session finds the exact words of anything it \
covers.";

/// A summary being written in the background. A session has at most one.
#[derive(Debug)]
pub struct PendingSummary {
    /// Stops it. A summary whose history was reset under it is cancelled,
    /// so it never lands on a conversation it was not written from.
    pub cancel: CancellationToken,
    /// Closes once the summary has landed or been abandoned.
    pub settled: tokio::sync::watch::Receiver<()>,
}

impl PendingSummary {
    /// Whether it is still being written. One whose task is gone - its
    /// agent was replaced mid-summary - is not.
    #[must_use]
    pub fn is_running(&self) -> bool {
        self.settled.has_changed().is_ok()
    }
}

/// Where a session's summaries stand: the one being written, and what an
/// attempt that failed leaves the next.
#[derive(Debug, Default)]
pub struct Summarizing {
    /// The summary being written in the background, if any.
    pub pending: Option<PendingSummary>,
    /// How many tokens the conversation took when the last summary to
    /// settle failed; `None` once one lands. Another is not tried until the
    /// conversation has grown well past it, so a summary that keeps failing
    /// is not paid for on every message.
    pub failed_at: Option<u64>,
    /// What each image a summary read shows, by the image's URI, kept until
    /// a summary lands so that trying again does not read them again.
    pub descriptions: HashMap<String, String>,
}

/// The in-memory state of one agent session.
#[derive(Debug)]
pub struct SessionState {
    /// The ACP session id minted by `session/new`, `None` until then.
    pub acp_session_id: Option<SessionId>,
    /// Model id turns run on; `session/set_config_option` moves it.
    pub model: String,
    /// Reasoning effort applied to subsequent turns.
    pub reasoning_effort: ReasoningEffort,
    /// Inference speed applied to subsequent turns.
    pub speed: agent::ModelSpeed,
    /// Who this agent is, snapshotted from the session's bot at attach.
    pub identity: Option<AgentIdentity>,
    /// Instructions every turn runs under, snapshotted from the session row
    /// at attach. Nothing moves them: they are the session's system prompt,
    /// and a conversation whose system prompt changed halfway is one the
    /// agent never agreed to.
    pub instructions: Option<String>,
    /// The conversation the model reads, oldest first: a summary of what
    /// came before, if there was one, then everything since.
    pub history: Vec<HistoryEntry>,
    /// The summary being written in the background, if any, and what the
    /// last attempt left for the next.
    pub summarizing: Summarizing,
}

impl SessionState {
    /// A fresh session on `model` with no conversation yet.
    #[must_use]
    pub fn new(model: String) -> Self {
        Self {
            acp_session_id: None,
            model,
            reasoning_effort: ReasoningEffort::default(),
            speed: agent::ModelSpeed::Standard,
            identity: None,
            instructions: None,
            history: Vec::new(),
            summarizing: Summarizing::default(),
        }
    }

    /// Start the conversation over: what the model reads and what it no
    /// longer does, and any summary of it still being written or tried.
    pub fn clear_history(&mut self) {
        self.history.clear();
        if let Some(summary) = std::mem::take(&mut self.summarizing).pending {
            summary.cancel.cancel();
        }
    }
}

/// Put a summary in place of the first `replaces` entries of `history`. The
/// log keeps what they said, and an earlier summary among them is covered
/// by the new one.
pub fn splice_summary(history: &mut Vec<HistoryEntry>, text: String, replaces: usize) {
    let replaces = replaces.min(history.len());
    history.drain(..replaces);
    history.insert(0, HistoryEntry::Summary(text));
}

/// Where the turn of the prompt that request `id` carried ends in
/// `history`: right after its last entry, where the next prompt starts.
/// `None` when `history` holds no such prompt.
#[must_use]
pub fn end_of_turn(history: &[HistoryEntry], id: &RequestId) -> Option<usize> {
    let start = history.iter().position(
        |entry| matches!(entry, HistoryEntry::User { request_id, .. } if request_id == id),
    )?;
    let after = start + 1;
    Some(
        history[after..]
            .iter()
            .position(|entry| matches!(entry, HistoryEntry::User { .. }))
            .map_or(history.len(), |next| after + next),
    )
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
        .flat_map(|entry| match entry {
            HistoryEntry::User { prompt, .. } => vec![prompt.to_chat_message()],
            HistoryEntry::Assistant(parts) => vec![assistant_message(parts.clone())],
            HistoryEntry::Summary(summary) => vec![
                UserPrompt::text(SUMMARY_PREAMBLE).to_chat_message(),
                assistant_message(vec![AssistantMessagePart::Text {
                    text: summary.clone(),
                }]),
            ],
        })
        .chain(std::iter::once(prompt.to_chat_message()))
        .collect()
}

fn assistant_message(parts: Vec<AssistantMessagePart>) -> ChatMessage {
    ChatMessage {
        content: ChatMessageContent::AssistantMessageParts(parts),
        role: Role::Assistant,
        attachments: None,
    }
}

/// Whether resolved attachments contain images, including nested attachments.
pub(super) fn contains_images(attachments: &Attachments<'_>) -> bool {
    fn content_has_images(content: &AttachmentContent<'_>) -> bool {
        content.content.iter().any(|part| match part {
            AttachmentPart::Image(_) => true,
            AttachmentPart::Child(child) => child.as_ref().as_ref().is_ok_and(content_has_images),
            _ => false,
        })
    }
    attachments
        .parts()
        .iter()
        .filter_map(|part| part.as_ref().ok())
        .any(content_has_images)
}
