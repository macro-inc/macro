//! Distinct session origins for mentions and task assignments.

use agent_runtime_protocol::domain::action::{AgentAction, PromptAttachment};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::AnnounceOrigin;

#[cfg(test)]
mod test;

/// Where a mention happened.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MentionOrigin {
    /// Channel or document the mentioning message was posted in.
    pub parent: messages::domain::models::MessageParent,
    /// Thread the announcement replies into: the mention's thread root.
    pub thread_id: Uuid,
    /// The mentioning message itself.
    pub message_id: Uuid,
    /// Who asked. Owns the session and is credited for its messages.
    pub sender: MacroUserIdStr<'static>,
    /// The message text, verbatim; becomes the session's first prompt.
    pub content: String,
    /// Files attached to the message, as the prompt will refer to them.
    #[serde(default)]
    pub attachments: Vec<PromptAttachment>,
}

/// A task assignment that starts a session without a user-authored mention.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TaskAssignmentOrigin {
    /// Original task whose discussion receives the session link.
    pub parent: messages::domain::models::MessageParent,
    /// Reserved agent-authored session link, also the discussion's root.
    pub discussion_id: Uuid,
    /// User who assigned the task and owns the session.
    pub actor: MacroUserIdStr<'static>,
    /// Task instructions supplied privately to the session.
    pub prompt: String,
}

/// The event that opens a managed session.
///
/// Untagged serialization preserves the existing mention command shape.
/// Assignments have distinct required fields and never deserialize as mentions.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum SessionOrigin {
    /// A user mentioned the agent in a message.
    Mention(MentionOrigin),
    /// A user assigned a task to the agent.
    TaskAssignment(TaskAssignmentOrigin),
}

impl SessionOrigin {
    pub(crate) fn session_instructions(&self, configured: &str) -> Option<String> {
        let configured = (!configured.trim().is_empty()).then(|| configured.to_owned());
        match self {
            Self::Mention(_) => configured,
            Self::TaskAssignment(origin) => {
                let task =
                    agent_trigger::domain::task_assignment::assignment_instructions(&origin.parent);
                Some(match configured {
                    Some(configured) => format!("{configured}\n\n{task}"),
                    None => task,
                })
            }
        }
    }

    pub(crate) fn actor(&self) -> &MacroUserIdStr<'static> {
        match self {
            Self::Mention(origin) => &origin.sender,
            Self::TaskAssignment(origin) => &origin.actor,
        }
    }

    pub(crate) fn kind(&self) -> &'static str {
        match self {
            Self::Mention(_) => "mention",
            Self::TaskAssignment(_) => "task_assignment",
        }
    }

    pub(crate) fn announcement(&self) -> AnnounceOrigin {
        match self {
            Self::Mention(origin) => AnnounceOrigin {
                reuse_origin_message: false,
                parent: origin.parent.clone(),
                thread_id: origin.thread_id,
                message_id: origin.message_id,
            },
            Self::TaskAssignment(origin) => AnnounceOrigin {
                reuse_origin_message: true,
                parent: origin.parent.clone(),
                thread_id: origin.discussion_id,
                message_id: origin.discussion_id,
            },
        }
    }

    pub(crate) fn into_action(self) -> AgentAction {
        match self {
            Self::Mention(origin) => {
                AgentAction::prompt_with_attachments(origin.content, origin.attachments)
            }
            Self::TaskAssignment(origin) => AgentAction::prompt(origin.prompt),
        }
    }
}
