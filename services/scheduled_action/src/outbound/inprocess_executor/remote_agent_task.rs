//! Run path for [`ActionKind::RemoteAgent`].
//!
//! Mirrors [`super::agent_task`] so the whole run surface — the chat, the live
//! update, the execution record, the completion notification — is inherited by
//! remote agents. The only difference is who produces the assistant message:
//! here it comes back over HTTP instead of from Macro's own agent loop.

use std::sync::Arc;

use agent::types::{AssistantMessagePart, ChatMessageContent, Role};
use anyhow::{Context, Result};
use macro_db_client::dcs::create_chat_message::create_chat_message;
use model::chat::NewChatMessage;
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use sqlx::PgPool;

use super::notify::notify_completion;
use crate::domain::models::{RemoteAgentRunRequest, RemoteAgentTask, ScheduledAction};
use crate::domain::ports::RemoteAgentClient;

pub async fn run_remote_agent_task<Remote: RemoteAgentClient>(
    db: &PgPool,
    remote_client: &Remote,
    notification_ingress: &Arc<SqsNotificationIngress<SqsQueue>>,
    action: &ScheduledAction,
    chat_id: &str,
) -> Result<()> {
    let task: RemoteAgentTask = serde_json::from_value(action.task.clone())
        .context("invalid remote agent task definition")?;

    let action_id = *action
        .id
        .as_ref()
        .context("scheduled action is missing an id")?;

    store_user_message(db, chat_id, &task).await?;

    let request = RemoteAgentRunRequest {
        action_id,
        chat_id: chat_id.to_string(),
        action_name: action.name.clone(),
        user_prompt: task.user_prompt.clone(),
    };

    let response = remote_client.run(&task, &request).await?;

    if response.output.trim().is_empty() {
        return Ok(());
    }

    store_assistant_message(db, chat_id, &task, &response.output).await?;
    notify_completion(notification_ingress, chat_id, action, &response.output);

    Ok(())
}

async fn store_user_message(db: &PgPool, chat_id: &str, task: &RemoteAgentTask) -> Result<String> {
    let now = chrono::Utc::now();
    let message = NewChatMessage {
        id: None,
        content: ChatMessageContent::Text(task.user_prompt.clone()),
        role: Role::User,
        attachments: None,
        created_at: now,
        updated_at: now,
        model: task.label().to_string(),
    };
    create_chat_message(db.clone(), chat_id, message).await
}

async fn store_assistant_message(
    db: &PgPool,
    chat_id: &str,
    task: &RemoteAgentTask,
    output: &str,
) -> Result<()> {
    let now = chrono::Utc::now();
    let message = NewChatMessage {
        id: None,
        content: ChatMessageContent::AssistantMessageParts(vec![AssistantMessagePart::Text {
            text: output.to_string(),
        }]),
        role: Role::Assistant,
        attachments: None,
        created_at: now,
        updated_at: now,
        model: task.label().to_string(),
    };
    create_chat_message(db.clone(), chat_id, message)
        .await
        .context("failed to store remote agent message")?;
    Ok(())
}
