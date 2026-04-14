//! GetThread tool for retrieving an email thread with its messages.

use crate::domain::{
    models::{ContactInfo, ParsedMessage, ParsedThread},
    ports::{EmailService, GmailTokenProvider},
};
use ai::tool::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::{
    models::{EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::EmailToolContext;

/// A simplified message for tool output.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolMessage {
    /// The message's unique identifier.
    pub id: Uuid,
    /// The message subject.
    pub subject: Option<String>,
    /// The sender's email and name.
    pub from: Option<ToolContact>,
    /// The To recipients.
    pub to: Vec<ToolContact>,
    /// The Cc recipients.
    pub cc: Vec<ToolContact>,
    /// The parsed plaintext body (reply/forwarded content stripped, HTML converted).
    pub body_parsed: Option<String>,
    /// When the message was received/sent.
    pub date: Option<String>,
}

/// A simplified contact for tool output.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolContact {
    /// The contact's email address.
    pub email: String,
    /// The contact's display name.
    pub name: Option<String>,
}

impl From<ContactInfo> for ToolContact {
    fn from(c: ContactInfo) -> Self {
        Self {
            email: c.email,
            name: c.name,
        }
    }
}

impl From<ParsedMessage> for ToolMessage {
    fn from(m: ParsedMessage) -> Self {
        Self {
            id: m.db_id,
            subject: m.subject,
            from: m.from.map(ToolContact::from),
            to: m.to.into_iter().map(ToolContact::from).collect(),
            cc: m.cc.into_iter().map(ToolContact::from).collect(),
            body_parsed: m.body_parsed,
            date: m.internal_date_ts.map(|t| t.to_rfc3339()),
        }
    }
}

/// Response from the GetThread tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetThreadResponse {
    /// The thread's unique identifier.
    pub thread_id: Uuid,
    /// Whether the thread has been read.
    pub is_read: bool,
    /// The messages in the thread (most recent first).
    pub messages: Vec<ToolMessage>,
    /// A human-readable summary.
    pub summary: String,
}

/// The default number of messages to retrieve.
const DEFAULT_LIMIT: i64 = 10;

/// Retrieve an email thread and its messages.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[schemars(
    title = "GetThread",
    description = "Retrieve an email thread and its messages. Returns the thread metadata and message contents including sender, recipients, subject, and body text. Use this to read the contents of a specific email conversation."
)]
#[serde(rename_all = "camelCase")]
pub struct ReadThread {
    /// The ID of the email thread to retrieve.
    pub thread_id: Uuid,
    /// Maximum number of messages to return (default 10).
    #[serde(default)]
    pub limit: Option<i64>,
}

#[async_trait]
impl<T, G, E> AsyncTool<EmailToolContext<T, G, E>> for ReadThread
where
    T: EmailService,
    G: GmailTokenProvider,
    E: EntityAccessService,
{
    type Output = GetThreadResponse;

    #[tracing::instrument(skip_all, fields(
        user_id=?request_context.user_id,
        thread_id=%self.thread_id,
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<EmailToolContext<T, G, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Get thread");

        let receipt = service_context
            .entity_access_service
            .generate_entity_access_receipt::<ViewAccessLevel>(
                &request_context.user_id,
                None,
                &self.thread_id.to_string(),
                EntityType::EmailThread,
            )
            .await
            .map_err(|e| ToolCallError {
                description: format!("Access denied for thread: {e}"),
                internal_error: e.into(),
            })?;

        let limit = self.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, 100);

        let thread = service_context
            .service
            .get_thread_parsed(receipt, 0, limit)
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to get thread: {e}"),
                internal_error: e.into(),
            })?
            .ok_or_else(|| ToolCallError {
                description: "Thread not found.".to_string(),
                internal_error: anyhow::anyhow!("Thread not found"),
            })?;

        let summary = build_summary(&thread);
        let messages: Vec<ToolMessage> =
            thread.messages.into_iter().map(ToolMessage::from).collect();

        Ok(GetThreadResponse {
            thread_id: thread.row.db_id,
            is_read: thread.row.is_read,
            messages,
            summary,
        })
    }
}

fn build_summary(thread: &ParsedThread) -> String {
    let msg_count = thread.messages.len();
    let subject = thread
        .messages
        .first()
        .and_then(|m| m.subject.as_deref())
        .unwrap_or("(no subject)");

    format!(
        "Thread with {msg_count} message{} — subject: \"{subject}\".",
        if msg_count == 1 { "" } else { "s" }
    )
}
