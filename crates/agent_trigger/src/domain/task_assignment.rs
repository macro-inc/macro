//! Start work for newly assigned agents in a task's discussion.

use std::collections::HashSet;

use agent_session::domain::error::Result as AgentResult;
use agent_session::domain::ports::AgentSessionRepo;
use bot_id::{BotId, BotIdStr};
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use messages::domain::{
    api::MessageCommands,
    events::MessagePostedMetadata,
    models::{MessageAttribution, MessageParent, PostMessage, PostMessageNotificationPolicy},
    service::MessageWrite,
};
use models_properties::{EntityType, service::property_value::PropertyValue};
use properties::domain::events::EntityPropertyUpdatedMetadata;
use system_properties::SystemPropertyKey;

use super::{
    broker_events::{AgentAssignedToTaskEvent, AgentSessionMacroEvent, NewAgentSessionEvent},
    processing::ProcessMessageEventError,
    service::{
        AgentBotLookup, AgentTriggerService, ChannelParticipationLookup, ExplicitReplyExtractor,
        ImplicitTriggerJudge, TeamMembershipLookup, ThreadHistory,
    },
};

#[cfg(test)]
mod test;

/// Authorized task content supplied to every runtime, including those without tools.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskBrief {
    /// Current task title.
    pub title: String,
    /// Current task description in Markdown.
    pub markdown: String,
}

/// Reads the task through its owning service under a verified document capability.
#[cfg_attr(test, mockall::automock)]
pub trait TaskAssignmentContext: Send + Sync + 'static {
    /// Missing or no-longer-task documents yield no work; read failures are retried.
    fn task_brief(
        &self,
        access: entity_access::domain::models::EntityAccessReceipt<MessageWrite>,
    ) -> impl Future<Output = AgentResult<Option<TaskBrief>>> + Send;
}

/// One committed assignment change, with only the newly assigned agents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskAssignment {
    /// The source event id also identifies the discussion root, including on replay.
    pub event_id: Uuid,
    /// Task document whose discussion receives the agent's replies.
    pub parent: MessageParent,
    /// User whose assignment starts the work.
    pub actor: MacroUserIdStr<'static>,
    /// Agents added by this change, in stable order.
    pub bots: Vec<BotId>,
}

impl TaskAssignment {
    /// Ignore other properties, human assignees, removals, and unchanged saves.
    pub fn from_update(event_id: Uuid, updated: &EntityPropertyUpdatedMetadata) -> Option<Self> {
        if updated.entity_type != EntityType::Task
            || updated.property_definition_id != SystemPropertyKey::Assignees.uuid()
        {
            return None;
        }
        let previous = assigned_bots(updated.previous_value.as_ref());
        let mut bots: Vec<_> = assigned_bots(updated.value.as_ref())
            .difference(&previous)
            .copied()
            .collect();
        bots.sort_by_key(ToString::to_string);
        if bots.is_empty() {
            return None;
        }
        Some(Self {
            event_id,
            parent: MessageParent::parse("document", &updated.entity_id).ok()?,
            actor: updated
                .actor_user_id
                .clone()
                .or_else(|| updated.on_behalf_of.clone())?,
            bots,
        })
    }
}

fn assigned_bots(value: Option<&PropertyValue>) -> HashSet<BotId> {
    let Some(PropertyValue::EntityRef(references)) = value else {
        return HashSet::new();
    };
    references
        .iter()
        .filter(|reference| reference.entity_type == EntityType::User)
        .filter_map(|reference| BotIdStr::parse_from_str(&reference.entity_id).ok())
        .map(|id| id.bot_id())
        .collect()
}

/// Open a real discussion before publishing a session trigger. The common
/// harness then announces the session here and routes subsequent replies.
pub async fn process_task_assignment<
    Repo,
    Bots,
    Teams,
    Channels,
    Replies,
    Judge,
    History,
    Broker,
    Context,
>(
    trigger: &AgentTriggerService<Repo, Bots, Teams, Channels, Replies, Judge, History>,
    publisher: &Broker,
    messages: &dyn MessageCommands,
    context: &Context,
    assignment: &TaskAssignment,
) -> Result<(), ProcessMessageEventError>
where
    Repo: AgentSessionRepo,
    Bots: AgentBotLookup,
    Teams: TeamMembershipLookup,
    Channels: ChannelParticipationLookup,
    Replies: ExplicitReplyExtractor,
    Judge: ImplicitTriggerJudge,
    History: ThreadHistory,
    Broker: MacroEventBroker,
    Context: TaskAssignmentContext,
{
    for &bot_id in &assignment.bots {
        let Some(invocation) = trigger
            .authorize_task_assignment(
                &assignment.actor,
                &assignment.parent,
                assignment.event_id,
                bot_id,
            )
            .await?
        else {
            continue;
        };
        if trigger
            .assignment_has_session(assignment.event_id, bot_id)
            .await?
        {
            continue;
        }
        let Some(brief) = context.task_brief(invocation.access().clone()).await? else {
            continue;
        };
        let Some(message) =
            assignment_discussion(assignment, &brief, invocation.access().clone(), messages)
                .await?
        else {
            continue;
        };
        let event = AgentSessionMacroEvent::new_session(NewAgentSessionEvent::AssignedToTask(
            AgentAssignedToTaskEvent { bot_id, message },
        ));
        publisher
            .send_event(&event)?
            .await
            .map_err(ProcessMessageEventError::PublishTask)??;
    }
    Ok(())
}

async fn assignment_discussion(
    assignment: &TaskAssignment,
    brief: &TaskBrief,
    access: entity_access::domain::models::EntityAccessReceipt<MessageWrite>,
    commands: &dyn MessageCommands,
) -> Result<Option<MessagePostedMetadata>, ProcessMessageEventError> {
    // Keep the task ID available to agent runtimes while displaying a task link
    // in the discussion. Escape tag delimiters in user-controlled titles.
    let task_reference = serde_json::json!({
        "documentId": assignment.parent.entity_id(),
        "documentName": brief.title,
        "blockName": "task",
        "blockParams": {},
    })
    .to_string()
    .replace('<', "\\u003c")
    .replace('>', "\\u003e");
    let message = commands
        .post_from_event(
            access,
            assignment.event_id,
            PostMessage {
                id: None,
                attribution: MessageAttribution::ActingUser,
                notification_policy: PostMessageNotificationPolicy::Silent,
                content: format!(
                    "{}\n\n<m-document-mention>{}</m-document-mention>\n\n{}",
                    include_str!("task_assignment/prompt.md").trim(),
                    task_reference,
                    brief.markdown,
                ),
                thread_id: None,
                anchor: None,
                mentions: Vec::new(),
                attachments: Vec::new(),
                nonce: None,
            },
        )
        .await
        .map_err(ProcessMessageEventError::Discussion)?;
    // A replay must not resurrect a discussion the user deleted or use
    // an unrelated message as the assignment's origin.
    if message.deleted_at.is_some()
        || message.parent != assignment.parent
        || message.thread_id.is_some()
        || message.sender_id.as_user() != Some(&assignment.actor)
    {
        return Ok(None);
    }
    Ok(Some(MessagePostedMetadata::from_message(
        &message,
        Vec::new(),
    )))
}
