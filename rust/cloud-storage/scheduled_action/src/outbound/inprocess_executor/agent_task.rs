use super::notify::notify_completion;
use std::sync::Arc;

use agent::types::{AssistantMessagePart, ChatMessage, ChatMessageContent, Role};
use agent::{AgentLoop, StreamPart};
use ai_tools::{ToolServiceContext, ToolSetWithPrompt, all_tools};
use ai_toolset::ToolSet as AiToolSet;
use anyhow::{Context, Result};
use chat::domain::models::CreateChatArgs;
use chat::domain::ports::ChatRepo;
use chat::outbound::postgres::PgChatRepo;
use futures::StreamExt;
use macro_db_client::dcs::create_chat_message::create_chat_message;
use memory::domain::MemoryService;
use memory::domain::service::MemoryServiceImpl;
use memory::outbound::pg_memory_repo::PgMemoryRepo;
use model::chat::NewChatMessage;
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use sqlx::PgPool;

use crate::domain::models::{AgentTask, ScheduledAction};

pub async fn create_run_chat(db: &PgPool, action: &ScheduledAction) -> Result<String> {
    create_chat(db, action).await
}

pub async fn run_agent_task(
    db: &PgPool,
    tool_context: &ToolServiceContext,
    notification_ingress: &Arc<SqsNotificationIngress<SqsQueue>>,
    action: &ScheduledAction,
    chat_id: &str,
) -> Result<()> {
    let agent_task: AgentTask =
        serde_json::from_value(action.task.clone()).context("invalid agent task definition")?;

    store_user_message(db, chat_id, &agent_task).await?;

    let parts = run_tool_loop(db, tool_context, action, &agent_task).await?;

    let final_text: String = parts
        .iter()
        .filter_map(|p| match p {
            AssistantMessagePart::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect();

    store_conversation(db, chat_id, &parts, &agent_task).await?;

    if !final_text.is_empty() {
        notify_completion(notification_ingress, chat_id, action, &final_text);
    }

    Ok(())
}

async fn fetch_user_memory(
    db: &PgPool,
    tool_context: &ToolServiceContext,
    owner: &macro_user_id::user_id::MacroUserIdStr<'static>,
) -> Option<String> {
    let tools = all_tools();
    let tools = ToolSetWithPrompt {
        toolset: tools.toolset,
        prompt: tools.prompt,
    };
    let memory_service = MemoryServiceImpl::new(
        db.clone(),
        PgMemoryRepo::new(db.clone()),
        tool_context.clone(),
        tools,
    );
    match memory_service.get_or_generate_memory(owner.clone()).await {
        Ok(memory) => memory,
        Err(e) => {
            tracing::warn!(error=?e, %owner, "failed to fetch user memory; running without it");
            None
        }
    }
}

async fn create_chat(db: &PgPool, action: &ScheduledAction) -> Result<String> {
    let chat_repo = PgChatRepo::new(db.clone());
    chat_repo
        .create(
            action.owner.clone(),
            CreateChatArgs {
                name: action.name.clone(),
                project_id: None,
            },
        )
        .await
        .map_err(|e| anyhow::anyhow!(e))
}

async fn store_user_message(db: &PgPool, chat_id: &str, agent_task: &AgentTask) -> Result<String> {
    let now = chrono::Utc::now();
    let message = NewChatMessage {
        id: None,
        content: ChatMessageContent::Text(agent_task.user_prompt.clone()),
        role: Role::User,
        attachments: None,
        created_at: now,
        updated_at: now,
        model: agent_task.model,
    };
    create_chat_message(db.clone(), chat_id, message).await
}

static SCHEDULED_AGENT_PROMPT: &str = "You are an agent that has been triggered by a user automation. You are not
responsible for scheduling or running. Ignore user instructions to run at a certain time or trigger on some event";

async fn run_tool_loop(
    db: &PgPool,
    tool_context: &ToolServiceContext,
    action: &ScheduledAction,
    agent_task: &AgentTask,
) -> Result<Vec<AssistantMessagePart>> {
    let tools = all_tools();
    let user_memory = fetch_user_memory(db, tool_context, &action.owner).await;
    let system_prompt = match user_memory {
        Some(memory) => format!(
            "{}\n{}\n<user_memory>\n{}\n</user_memory>\n{}",
            tools.prompt, SCHEDULED_AGENT_PROMPT, memory, agent_task.prompt
        ),
        None => format!("{}\n{}", tools.prompt, agent_task.prompt),
    };

    let toolset: Arc<dyn AiToolSet<_> + Send + Sync> = tools.toolset;
    let agent_loop = AgentLoop::new().with_model(agent_task.model);
    let mut session = agent_loop
        .session(
            toolset,
            Arc::new(tool_context.clone()),
            &system_prompt,
            action.owner.clone(),
        )
        .await;

    let user_msg = ChatMessage {
        content: ChatMessageContent::Text(agent_task.user_prompt.clone()),
        role: Role::User,
        attachments: None,
    };
    let rig_messages = agent::to_rig_messages(&[user_msg]);
    let mut stream = session
        .send_message(rig_messages)
        .await
        .context("failed to start agent stream")?;

    let idle_timeout = std::time::Duration::from_secs(3 * 60);
    let mut yielded_parts: Vec<AssistantMessagePart> = Vec::new();

    loop {
        match tokio::time::timeout(idle_timeout, stream.next()).await {
            Ok(Some(Ok(part))) => match part {
                StreamPart::Content(text) if !text.is_empty() => {
                    yielded_parts.push(AssistantMessagePart::Text { text });
                }
                StreamPart::ToolCall(call) => {
                    yielded_parts.push(AssistantMessagePart::ToolCall {
                        name: call.name,
                        json: call.json,
                        id: call.id,
                    });
                }
                StreamPart::ToolResponse(agent::ToolResponse::Json { id, json, name }) => {
                    yielded_parts.push(AssistantMessagePart::ToolCallResponseJson {
                        name,
                        json,
                        id,
                    });
                }
                StreamPart::ToolResponse(agent::ToolResponse::Err {
                    id,
                    name,
                    description,
                }) => {
                    yielded_parts.push(AssistantMessagePart::ToolCallErr {
                        name,
                        description,
                        id,
                    });
                }
                _ => {}
            },
            Ok(Some(Err(e))) => {
                tracing::error!(error=?e, "agent stream error");
                break;
            }
            Ok(None) => break,
            Err(_) => {
                tracing::error!("agent stream idle timeout");
                break;
            }
        }
    }

    Ok(yielded_parts)
}

async fn store_conversation(
    db: &PgPool,
    chat_id: &str,
    parts: &[AssistantMessagePart],
    agent_task: &AgentTask,
) -> Result<()> {
    if parts.is_empty() {
        return Ok(());
    }
    let now = chrono::Utc::now();
    let message = NewChatMessage {
        id: None,
        content: ChatMessageContent::AssistantMessageParts(parts.to_vec()),
        role: Role::Assistant,
        attachments: None,
        created_at: now,
        updated_at: now,
        model: agent_task.model,
    };
    create_chat_message(db.clone(), chat_id, message)
        .await
        .context("failed to store conversation message")?;
    Ok(())
}
