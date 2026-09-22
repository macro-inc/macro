//! Adapter that starts an agent assigned to a task.
//!
//! Assigning an agent is the same act as summoning it in a conversation, so
//! this posts an ordinary mention in the task's own discussion, as the
//! assigning user, and lets the existing trigger pipeline authorize the
//! invocation and open the session. Nothing here decides whether the agent may
//! run; the trigger service still applies every rule it applies to a person
//! typing the same mention.

use std::sync::{Arc, OnceLock};

use bots::domain::ports::BotRepo;
use entity_access::domain::{models::EntityType, ports::EntityAccessService};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    api::MessageCommands,
    mentions::BOT_MENTION_ENTITY_TYPE,
    models::{MessageAttribution, PostMessage, PostMessageNotificationPolicy, SimpleMention},
    service::MessageWrite,
};
use properties::{AgentAssignmentService, TaskAgentAssignment};

/// Summons an agent in the discussion of the task it was assigned to.
pub struct TaskDiscussionAgentAssignment<Access, Bots> {
    /// Bound after construction: the properties service that owns this port is
    /// composed before the message service it posts through.
    messages: OnceLock<Arc<dyn MessageCommands>>,
    access: Access,
    bots: Bots,
}

impl<Access, Bots> TaskDiscussionAgentAssignment<Access, Bots> {
    /// Build the adapter with the capabilities available at composition time.
    pub fn new(access: Access, bots: Bots) -> Self {
        Self {
            messages: OnceLock::new(),
            access,
            bots,
        }
    }

    /// Supply the message boundary once it exists. Posting is a no-op until
    /// this is called.
    pub fn bind_messages(&self, messages: Arc<dyn MessageCommands>) {
        if self.messages.set(messages).is_err() {
            tracing::error!("task agent assignment messages bound twice");
        }
    }
}

/// What the agent is told when a task lands on it. The task is the
/// conversation's parent, so the agent reads the work from the task itself.
fn assignment_prompt(
    agent_mention: &str,
    assigned_by: &MacroUserIdStr<'_>,
) -> Result<String, serde_json::Error> {
    let assigner_mention = mention_utils::serialize::user_mention(assigned_by)?;
    Ok(format!(
        "{agent_mention} {assigner_mention} assigned you this task. Please pick it up."
    ))
}

impl<Access, Bots> AgentAssignmentService for TaskDiscussionAgentAssignment<Access, Bots>
where
    Access: EntityAccessService,
    Bots: BotRepo,
    anyhow::Error: From<Bots::Err>,
{
    type Err = anyhow::Error;

    async fn start_assigned_agent<'a>(
        &self,
        assignment: TaskAgentAssignment<'a>,
    ) -> Result<(), Self::Err> {
        let Some(messages) = self.messages.get() else {
            anyhow::bail!("task agent assignment used before the message service was bound");
        };

        // A bot without an agent is an ordinary assignee: it can own the task
        // without anything being summoned.
        let Some(bot) = self.bots.get_bot(assignment.bot_id).await? else {
            tracing::debug!(bot_id = %assignment.bot_id, "assigned bot not found; nothing to start");
            return Ok(());
        };
        if !bot.has_agent {
            return Ok(());
        }

        let task_id = assignment.task_id.to_string();
        let access = self
            .access
            .generate_entity_access_receipt::<MessageWrite>(
                &assignment.assigned_by,
                None,
                &task_id,
                EntityType::Document,
            )
            .await?;

        let agent_mention = mention_utils::serialize::bot_mention(assignment.bot_id, &bot.name)?;
        messages
            .post(
                access,
                PostMessage {
                    attribution: MessageAttribution::ActingUser,
                    // The assignment itself notifies people; this post exists
                    // to reach the agent.
                    notification_policy: PostMessageNotificationPolicy::MentionsOnly,
                    content: assignment_prompt(&agent_mention, &assignment.assigned_by)?,
                    thread_id: None,
                    anchor: None,
                    mentions: vec![
                        SimpleMention {
                            entity_type: BOT_MENTION_ENTITY_TYPE.to_owned(),
                            entity_id: assignment.bot_id.into_storage_id().as_ref().to_owned(),
                        },
                        SimpleMention::user(&assignment.assigned_by),
                    ],
                    attachments: Vec::new(),
                    nonce: None,
                },
            )
            .await?;
        Ok(())
    }
}
