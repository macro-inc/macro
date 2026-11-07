//! Retitling: replacing a session's generated name once the conversation
//! shows the name no longer describes it.
//!
//! A session is named from its first prompt, before the agent has looked at
//! anything, so the name is often as vague as the prompt ("Investigate
//! Issue"). After each finished turn the session's namer is shown this digest
//! and may propose a better name; it keeps the current one unless that has
//! clearly stopped fitting, so names change rarely.

use agent_fold::domain::model::{Author, FoldedMessage, MessagePart};
use serde::Serialize;

#[cfg(test)]
mod test;

/// Characters kept from each message. What a message is about shows up early.
const MAX_MESSAGE_CHARS: usize = 1_000;
/// Messages kept from the end of the conversation, besides the first prompt.
const MAX_RECENT_MESSAGES: usize = 8;

/// A session's conversation, bounded for a fast model: the first prompt,
/// which usually states the task, and the latest messages, which show where
/// the work went. Only prose; tool activity and reasoning are left out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConversationDigest {
    /// Oldest first.
    pub messages: Vec<DigestMessage>,
}

/// One message of a [`ConversationDigest`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DigestMessage {
    /// Who wrote it.
    pub role: DigestRole,
    /// Its prose, cut to a bounded length.
    pub text: String,
}

/// Who wrote a [`DigestMessage`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, strum::Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum DigestRole {
    /// A person's prompt.
    User,
    /// The agent's reply.
    Agent,
}

impl ConversationDigest {
    /// The digest of a session's folded messages, oldest first.
    #[must_use]
    pub fn from_messages(messages: &[FoldedMessage]) -> Self {
        let prose: Vec<DigestMessage> = messages
            .iter()
            .filter_map(DigestMessage::from_folded)
            .collect();
        let recent = prose.len().saturating_sub(MAX_RECENT_MESSAGES).max(1);
        let messages = prose
            .iter()
            .take(1)
            .chain(prose.get(recent..).unwrap_or_default())
            .cloned()
            .collect();
        Self { messages }
    }

    /// Whether the agent has replied with any prose: until it has, the
    /// conversation says nothing the first prompt did not.
    #[must_use]
    pub fn has_reply(&self) -> bool {
        self.messages
            .iter()
            .any(|message| message.role == DigestRole::Agent)
    }
}

impl DigestMessage {
    fn from_folded(message: &FoldedMessage) -> Option<Self> {
        let (role, text) = match message.author {
            Author::User { .. } => (
                DigestRole::User,
                message
                    .parts
                    .iter()
                    .filter_map(|part| match part {
                        MessagePart::Text { text } => Some(text.trim()),
                        _ => None,
                    })
                    .filter(|text| !text.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n"),
            ),
            // A reply's last prose is its answer or summary; what came before
            // is usually narration of the work.
            Author::Agent => (DigestRole::Agent, message.last_text()?),
        };
        let text: String = text.chars().take(MAX_MESSAGE_CHARS).collect();
        (!text.is_empty()).then_some(Self { role, text })
    }
}
