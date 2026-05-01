use super::notify::notify_completion;
use std::sync::Arc;

use ai::tool::ToolLoop;
use ai::types::{ChatMessage, ChatMessageContent, RequestBuilder, Role};
use ai_tools::{ToolServiceContext, ToolSetWithPrompt, all_tools};
use ai_toolset::RequestContext;
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

/// Create the chat that will hold this run's transcript. Called synchronously
/// by the executor so the chat_id can be returned to the caller and persisted
/// on the execution record before the background task starts.
pub async fn create_run_chat(db: &PgPool, action: &ScheduledAction) -> Result<String> {
    create_chat(db, action).await
}

/// Runs the agent tool loop against an already-created chat. Stores the user
/// prompt and the resulting conversation into that chat, then fires a
/// best-effort notification so the owner knows the run finished.
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

    let messages = run_tool_loop(db, tool_context, action, &agent_task).await?;

    let final_assistant_text = messages
        .iter()
        .rev()
        .find(|m| m.role == Role::Assistant)
        .and_then(|m| m.content.assistant_message_text());

    store_conversation(db, chat_id, messages, &agent_task).await?;

    if let Some(text) = final_assistant_text {
        notify_completion(notification_ingress, chat_id, action, &text);
    }

    Ok(())
}

/// Fetch the owner's persisted memory to inject as system-prompt context.
///
/// [`MemoryServiceImpl::get_or_generate_memory`] returns the existing memory
/// (if any) synchronously and spawns a background refresh when the memory is
/// missing or stale, so this call does not block agent execution on generation.
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
) -> Result<Vec<ChatMessage>> {
    let tools = all_tools();
    let user_memory = fetch_user_memory(db, tool_context, &action.owner).await;
    let system_prompt = match user_memory {
        Some(memory) => format!(
            "{}\n{}\n<user_memory>\n{}\n</user_memory>\n{}",
            tools.prompt, SCHEDULED_AGENT_PROMPT, memory, agent_task.prompt
        ),
        None => format!("{}\n{}", tools.prompt, agent_task.prompt),
    };
    let request = RequestBuilder::new()
        .model(agent_task.model)
        .messages(vec![ChatMessage {
            content: ChatMessageContent::Text(agent_task.user_prompt.clone()),
            attachments: None,
            role: Role::User,
        }])
        .system_prompt(system_prompt)
        .max_tokens(16000)
        .build();

    let request_context = RequestContext {
        user_id: action.owner.clone(),
    };

    let mut chat = ToolLoop::new(tools.toolset, tool_context.clone()).chat();
    let mut stream = chat
        .send_message(request, request_context, action.owner.to_string())
        .await
        .context("failed to start agent stream")?;

    let idle_timeout = std::time::Duration::from_secs(3 * 60);
    loop {
        match tokio::time::timeout(idle_timeout, stream.next()).await {
            Ok(Some(Ok(_))) => {}
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

    drop(stream);
    Ok(chat.get_new_conversation_messages())
}

async fn store_conversation(
    db: &PgPool,
    chat_id: &str,
    messages: Vec<ChatMessage>,
    agent_task: &AgentTask,
) -> Result<()> {
    let now = chrono::Utc::now();
    for message in messages {
        let new_message = NewChatMessage {
            id: None,
            content: message.content,
            role: message.role,
            attachments: None,
            created_at: now,
            updated_at: now,
            model: agent_task.model,
        };
        create_chat_message(db.clone(), chat_id, new_message)
            .await
            .context("failed to store conversation message")?;
    }
    Ok(())
}
