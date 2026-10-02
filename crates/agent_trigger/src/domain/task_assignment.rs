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
    /// The source event id identifies this assignment, including on replay.
    pub event_id: Uuid,
    /// Task document whose discussion receives the agent session link.
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
/// harness then links the session here and routes subsequent user replies.
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
        let discussion_id = discussion_id(assignment.event_id, bot_id);
        if trigger
            .assignment_has_session(discussion_id, bot_id)
            .await?
        {
            continue;
        }
        let Some(brief) = context.task_brief(invocation.access().clone()).await? else {
            continue;
        };
        let Some(message) = assignment_discussion(
            assignment,
            bot_id,
            discussion_id,
            invocation.access().clone(),
            messages,
        )
        .await?
        else {
            continue;
        };
        let event = AgentSessionMacroEvent::new_session(NewAgentSessionEvent::AssignedToTask(
            AgentAssignedToTaskEvent {
                bot_id,
                parent: assignment.parent.clone(),
                discussion_id: message.id,
                actor: assignment.actor.clone(),
                prompt: assignment_prompt(assignment, &brief),
            },
        ));
        publisher
            .send_event(&event)?
            .await
            .map_err(ProcessMessageEventError::PublishTask)??;
    }
    Ok(())
}

/// Derive one replay-stable UUIDv7 per assigned bot, retaining the event timestamp.
/// The hashed random bits keep simultaneous agents in separate discussion threads.
fn discussion_id(event_id: Uuid, bot_id: BotId) -> Uuid {
    use sha2::{Digest, Sha256};
    let hash = Sha256::new()
        .chain_update(event_id.as_bytes())
        .chain_update(bot_id.as_uuid().as_bytes())
        .finalize();
    let mut bytes = *event_id.as_bytes();
    bytes[6..].copy_from_slice(&hash[..10]);
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}

fn assignment_prompt(assignment: &TaskAssignment, brief: &TaskBrief) -> String {
    format!(
        "{}\n\n{}\n\n{}",
        include_str!("task_assignment/prompt.md").trim(),
        task_reference(&assignment.parent, &brief.title),
        brief.markdown,
    )
}

/// Persistent task guidance for session system instructions, without snapshotting
/// the mutable task description into the system prompt.
pub fn assignment_instructions(parent: &MessageParent) -> String {
    format!(
        "{}\n\n{}",
        include_str!("task_assignment/prompt.md").trim(),
        task_reference(parent, "Original assigned task"),
    )
}

fn task_reference(parent: &MessageParent, title: &str) -> String {
    // Escape tag delimiters in user-controlled titles and retain the original
    // document ID in both the private opening prompt and system instructions.
    let task_reference = serde_json::json!({
        "documentId": parent.entity_id(),
        "documentName": title,
        "blockName": "task",
        "blockParams": {},
    })
    .to_string()
    .replace('<', "\\u003c")
    .replace('>', "\\u003e");
    format!("<m-document-mention>{task_reference}</m-document-mention>")
}

async fn assignment_discussion(
    assignment: &TaskAssignment,
    bot_id: BotId,
    discussion_id: Uuid,
    access: entity_access::domain::models::EntityAccessReceipt<MessageWrite>,
    commands: &dyn MessageCommands,
) -> Result<Option<messages::domain::models::Message>, ProcessMessageEventError> {
    use entity_access::domain::models::{BotReceiptScope, EntityAccessReceipt};
    // Agent availability and the assigning user's capability were checked by
    // authorize_task_assignment. The response spends that same capability.
    let access = EntityAccessReceipt::try_new_bot(
        bot_id.into(),
        BotReceiptScope::User {
            acting_user: assignment.actor.clone(),
        },
        access.entity().clone(),
        *access.entity_permission(),
    )
    .map_err(|_| {
        ProcessMessageEventError::Discussion(messages::domain::ports::MessageError::Forbidden)
    })?;
    let message = commands
        .post_from_event(
            access,
            discussion_id,
            PostMessage {
                id: None,
                attribution: MessageAttribution::ActingUser,
                notification_policy: PostMessageNotificationPolicy::Silent,
                content: "Working on this task…".to_owned(),
                thread_id: None,
                anchor: None,
                mentions: Vec::new(),
                attachments: Vec::new(),
                nonce: None,
            },
        )
        .await
        .map_err(ProcessMessageEventError::Discussion)?;
    // A replay must not resurrect a response the user deleted.
    if message.deleted_at.is_some()
        || message.parent != assignment.parent
        || message.thread_id.is_some()
        || message.sender_id.as_bot().map(|id| id.bot_id()) != Some(bot_id)
    {
        return Ok(None);
    }
    Ok(Some(message))
}
