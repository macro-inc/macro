//! Authorized conversation reads with bounded responses over the app's session fold.

use agent_fold::domain::{fold::fold, model::FoldedMessage};
use entity_access::domain::models::{EntityAccessReceipt, EntityType, ViewAccessLevel};
use serde::Serialize;

use super::{
    error::{AgentSessionError, Result},
    model::{AgentSession, AgentSessionId},
    ports::{AgentSessionLogRepo, AgentSessionRepo},
};

const MAX_MESSAGES: usize = 20;
const MAX_MESSAGE_CHARS: usize = 4_000;

/// A readable session conversation, including tool activity and failures.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct SessionConversation {
    /// Session identity.
    pub session_id: uuid::Uuid,
    /// User-facing session name.
    pub name: String,
    /// Owner's principal id.
    pub owner_id: String,
    /// Agent persona id.
    pub bot_id: uuid::Uuid,
    /// Whether the session is archived and read-only.
    pub is_archived: bool,
    /// Configured runtime.
    pub harness: String,
    /// Selected model.
    pub model: String,
    /// Last runtime status.
    pub status: String,
    /// Messages in the requested turn, or the latest messages, oldest first.
    pub messages: Vec<SessionConversationMessage>,
    /// Number of messages matching the requested turn before bounding.
    pub total_messages: usize,
    /// Whether older messages or text were omitted.
    pub truncated: bool,
}

/// One folded prompt or reply.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct SessionConversationMessage {
    /// Turn number; pass it back to read that turn specifically.
    pub turn: u32,
    /// Whether this message came from the user or agent.
    pub role: SessionMessageRole,
    /// Readable prose, tool activity, outputs, and errors.
    pub content: String,
    /// Terminal runtime error, retained separately even when earlier text is truncated.
    pub failure: Option<String>,
    /// Whether this message's text exceeded the character budget.
    pub truncated: bool,
}

/// The two sides of a session conversation.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum SessionMessageRole {
    /// A user prompt.
    User,
    /// An agent reply.
    Agent,
}

/// Read-only use case over the session's existing persistence ports.
#[derive(Clone)]
pub struct SessionReader<R> {
    repo: R,
}

impl<R> SessionReader<R> {
    /// Compose the session repository at the application boundary.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R: AgentSessionRepo + AgentSessionLogRepo> SessionReader<R> {
    /// Read only the session named by a verified view-access capability.
    #[tracing::instrument(name = "agent_session.read_conversation", skip_all, fields(session_id = %access.entity().entity_id), err)]
    pub async fn read(
        &self,
        access: EntityAccessReceipt<ViewAccessLevel>,
        turn: Option<u32>,
    ) -> Result<SessionConversation> {
        if access.entity().entity_type != EntityType::AgentSession {
            return Err(AgentSessionError::Forbidden);
        }
        let id = uuid::Uuid::parse_str(&access.entity().entity_id)
            .map_err(|_| AgentSessionError::Forbidden)?;
        let session_id = AgentSessionId::new_from_uuid(id);
        let session = self.repo.get(session_id).await?;
        let log = AgentSessionLogRepo::list_by_session(&self.repo, session_id).await?;
        let messages = fold(log.into_iter().map(|entry| entry.entry));
        Ok(conversation(&session, messages, turn))
    }
}

fn conversation(
    session: &AgentSession,
    messages: Vec<FoldedMessage>,
    turn: Option<u32>,
) -> SessionConversation {
    let matching: Vec<_> = messages
        .into_iter()
        .filter(|message| turn.is_none_or(|turn| message.id.0 == turn))
        .collect();
    let total_messages = matching.len();
    let messages: Vec<_> = matching
        .into_iter()
        .skip(total_messages.saturating_sub(MAX_MESSAGES))
        .map(|message| {
            let text = message.searchable_text();
            let content: String = text.chars().take(MAX_MESSAGE_CHARS).collect();
            let (failure, failure_truncated) = match &message.stop {
                Some(agent_fold::domain::model::StopReason::Failed { message, .. }) => {
                    let failure: String = message.chars().take(MAX_MESSAGE_CHARS).collect();
                    let truncated = failure.len() < message.len();
                    (Some(failure), truncated)
                }
                _ => (None, false),
            };
            SessionConversationMessage {
                turn: message.id.0,
                role: match message.author {
                    agent_fold::domain::model::Author::User { .. } => SessionMessageRole::User,
                    agent_fold::domain::model::Author::Agent => SessionMessageRole::Agent,
                },
                truncated: content.len() < text.len() || failure_truncated,
                content,
                failure,
            }
        })
        .collect();
    SessionConversation {
        session_id: session.id.as_uuid(),
        name: session.name.clone(),
        owner_id: session.owner_id.to_string(),
        bot_id: session.bot_id.as_uuid(),
        is_archived: session.is_archived,
        harness: session.harness.clone(),
        model: session.model.clone(),
        status: match &session.status {
            super::model::SessionStatus::Event(event) => event.as_str().to_string(),
            status => status.as_ref().to_string(),
        },
        truncated: messages.len() < total_messages || messages.iter().any(|m| m.truncated),
        messages,
        total_messages,
    }
}

#[cfg(test)]
mod test;
