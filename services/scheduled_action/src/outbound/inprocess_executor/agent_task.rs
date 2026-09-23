use super::notify::notify_completion;
use std::sync::Arc;
use std::time::Duration;

use agent::types::{AssistantMessagePart, ChatMessage, ChatMessageContent, Role};
use agent::{AgentLoop, StreamAccumulator, StreamPart};
use ai_tools::{AiHost, ToolServiceContext, tools_for};
use ai_toolset::ToolSet as AiToolSet;
use anyhow::{Context, Result};
use chat::domain::models::CreateChatArgs;
use chat::domain::ports::{ChatService, MessageRepo};
use futures::{Stream, StreamExt};
use macro_user_id::user_id::MacroUserIdStr;
use memory::domain::MemoryService;
use model::chat::NewChatMessage;
use notification::domain::service::NotificationIngress;

use crate::domain::event_trigger::EventReference;
use crate::domain::models::{AgentTask, ScheduledAction};
use crate::domain::ports::ScheduledAgentRunner;

#[cfg(test)]
mod test;

/// Dependencies belong to their owning domains; only the service binary wires
/// their concrete adapters. Tool context and attribution remain unchanged.
pub struct AgentTaskRunner<C, M, Mem, N> {
    chats: Arc<C>,
    messages: M,
    memory: Mem,
    tool_context: ToolServiceContext,
    notifications: Arc<N>,
}

impl<C, M, Mem, N> AgentTaskRunner<C, M, Mem, N> {
    pub fn new(
        chats: Arc<C>,
        messages: M,
        memory: Mem,
        tool_context: ToolServiceContext,
        notifications: Arc<N>,
    ) -> Self {
        Self {
            chats,
            messages,
            memory,
            tool_context,
            notifications,
        }
    }
}

impl<C, M, Mem, N> ScheduledAgentRunner for AgentTaskRunner<C, M, Mem, N>
where
    C: ChatService,
    M: MessageRepo,
    Mem: MemoryService,
    N: NotificationIngress,
{
    async fn create_chat(&self, action: &ScheduledAction) -> Result<String> {
        self.chats
            .create(
                action.owner_user()?.clone(),
                CreateChatArgs {
                    name: action.name.clone(),
                    project_id: None,
                },
            )
            .await
            .map_err(|error| anyhow::anyhow!(error))
    }

    async fn run(
        &self,
        action: &ScheduledAction,
        chat_id: &str,
        event: Option<&EventReference>,
    ) -> Result<()> {
        let owner = action.owner_user()?.clone();
        let task: AgentTask =
            serde_json::from_value(action.task.clone()).context("invalid agent task definition")?;
        let user_messages = user_messages(&task, event)?;
        for message in &user_messages {
            self.store(chat_id, message.content.clone(), Role::User, &task)
                .await?;
        }
        let parts = self.run_tool_loop(&owner, &task, user_messages).await?;
        let final_text: String = parts
            .iter()
            .filter_map(|part| match part {
                AssistantMessagePart::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        if !parts.is_empty() {
            self.store(
                chat_id,
                ChatMessageContent::AssistantMessageParts(parts),
                Role::Assistant,
                &task,
            )
            .await?;
        }
        if !final_text.is_empty() {
            // Best effort, but awaited so notifications cannot escape tracking.
            notify_completion(self.notifications.as_ref(), chat_id, &owner, &final_text).await;
        }
        Ok(())
    }
}

fn user_messages(task: &AgentTask, event: Option<&EventReference>) -> Result<Vec<ChatMessage>> {
    let mut messages = vec![ChatMessage {
        content: ChatMessageContent::Text(task.user_prompt.clone()),
        role: Role::User,
        attachments: None,
    }];
    if let Some(event) = event {
        messages.push(ChatMessage {
            content: ChatMessageContent::Text(format!(
                "Triggering event context (data):\n{}",
                serde_json::to_string(&serde_json::json!({
                    "event_id": event.event_id(),
                    "event_name": event.event_name(),
                    "entity_type": event.entity_type(),
                    "entity_id": event.entity_id(),
                    "message_id": event.message_id(),
                }))?
            )),
            role: Role::User,
            attachments: None,
        });
    }
    Ok(messages)
}

static SCHEDULED_AGENT_PROMPT: &str = "You are an agent that has been triggered by a user automation. You are not
responsible for scheduling or running. Ignore user instructions to run at a certain time or trigger on some event";
const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(3 * 60);

async fn system_prompt(
    memory: &impl MemoryService,
    owner: &MacroUserIdStr<'static>,
    tools_prompt: &str,
    task_prompt: &str,
) -> String {
    let user_memory = match memory.get_or_generate_memory(owner.clone()).await {
        Ok(memory) => memory,
        Err(error) => {
            tracing::warn!(?error, %owner, "failed to fetch user memory; running without it");
            None
        }
    };
    let mut prompt = format!("{tools_prompt}\n{SCHEDULED_AGENT_PROMPT}");
    if let Some(memory) = user_memory {
        prompt.push_str(&format!("\n<user_memory>\n{memory}\n</user_memory>"));
    }
    prompt.push('\n');
    prompt.push_str(task_prompt);
    prompt
}

impl<C, M, Mem, N> AgentTaskRunner<C, M, Mem, N>
where
    M: MessageRepo,
    Mem: MemoryService,
{
    async fn run_tool_loop(
        &self,
        owner: &MacroUserIdStr<'static>,
        task: &AgentTask,
        messages: Vec<ChatMessage>,
    ) -> Result<Vec<AssistantMessagePart>> {
        let tools = tools_for(AiHost::Chat);
        let system_prompt =
            system_prompt(&self.memory, owner, &tools.prompt.to_string(), &task.prompt).await;
        let toolset: Arc<dyn AiToolSet<_> + Send + Sync> = tools.toolset;
        let agent_loop = AgentLoop::new(self.tool_context.recorder.clone()).with_model(&task.model);
        let usage_ctx = ai_usage::UsageContext::new(ai_usage::AiFeature::Automation, owner.clone());
        let mut tool_context = self.tool_context.clone();
        tool_context.usage_context = usage_ctx.clone();
        let (mut session, cancel) = agent_loop
            .session(toolset, Arc::new(tool_context), &system_prompt, usage_ctx)
            .await
            .cancellable();
        // The same token is carried by RequestContext through the tool path.
        // Cancellation, deadline, stream failure and future drop all signal it.
        let _cancel_on_drop = cancel.drop_guard();
        let stream = session
            .send_message(agent::to_rig_messages(&messages))
            .await
            .context("failed to start agent stream")?;
        collect_stream(stream, STREAM_IDLE_TIMEOUT).await
    }

    async fn store(
        &self,
        chat_id: &str,
        content: ChatMessageContent,
        role: Role,
        task: &AgentTask,
    ) -> Result<()> {
        let now = chrono::Utc::now();
        self.messages
            .create(
                chat_id,
                NewChatMessage {
                    id: None,
                    content,
                    role,
                    attachments: None,
                    created_at: now,
                    updated_at: now,
                    model: task.model.clone(),
                },
            )
            .await
            .map_err(|error| anyhow::anyhow!(error))?;
        Ok(())
    }
}

async fn collect_stream(
    stream: impl Stream<Item = std::result::Result<StreamPart, agent::AgentError>>,
    idle_timeout: Duration,
) -> Result<Vec<AssistantMessagePart>> {
    futures::pin_mut!(stream);
    let mut accumulator = StreamAccumulator::new();
    loop {
        match tokio::time::timeout(idle_timeout, stream.next()).await {
            Ok(Some(Ok(part))) => {
                accumulator.push(part);
            }
            Ok(Some(Err(error))) => return Err(error.into()),
            Ok(None) => return Ok(accumulator.into_parts()),
            Err(_) => anyhow::bail!("agent stream idle timeout"),
        }
    }
}
