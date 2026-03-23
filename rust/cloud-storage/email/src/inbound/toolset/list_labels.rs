//! ListLabels tool for listing a user's email labels.

use crate::domain::{
    models::{LabelType, LinkLabel},
    ports::{EmailService, GmailTokenProvider},
};
use ai::tool::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::EmailToolContext;

/// A simplified label for tool output.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolLabel {
    /// The label's unique identifier.
    pub id: Uuid,
    /// The display name of the label.
    pub name: String,
    /// Whether this is a "system" or "user" label.
    #[serde(rename = "type")]
    pub type_: String,
}

impl From<LinkLabel> for ToolLabel {
    fn from(label: LinkLabel) -> Self {
        let type_ = match label.type_ {
            LabelType::System => "system".to_string(),
            LabelType::User => "user".to_string(),
        };
        Self {
            id: label.id,
            name: label.name,
            type_,
        }
    }
}

/// Response from the ListLabels tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListLabelsResponse {
    /// The user's email labels.
    pub labels: Vec<ToolLabel>,
    /// A human-readable summary of the labels.
    pub summary: String,
}

/// List the user's email labels (INBOX, SENT, custom labels, etc.).
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[schemars(
    title = "ListLabels",
    description = "List the user's email labels including system labels (INBOX, SENT, DRAFTS, etc.) and any custom user-created labels. Use this to understand how the user's email is organized before filtering or searching by label."
)]
pub struct ListLabels {}

#[async_trait]
impl<T, G, E> AsyncTool<EmailToolContext<T, G, E>> for ListLabels
where
    T: EmailService,
    G: GmailTokenProvider,
    E: EntityAccessService,
{
    type Output = ListLabelsResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<EmailToolContext<T, G, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("List labels");

        let link = service_context
            .resolve_link((*request_context.user_id).clone())
            .await?;

        let labels = service_context
            .service
            .list_labels(&link)
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to list labels: {e}"),
                internal_error: e.into(),
            })?;

        let tool_labels: Vec<ToolLabel> = labels.into_iter().map(ToolLabel::from).collect();
        let summary = build_summary(&tool_labels);

        Ok(ListLabelsResponse {
            labels: tool_labels,
            summary,
        })
    }
}

pub(super) fn build_summary(labels: &[ToolLabel]) -> String {
    if labels.is_empty() {
        return "No email labels found.".to_string();
    }

    let system_count = labels.iter().filter(|l| l.type_ == "system").count();
    let user_count = labels.iter().filter(|l| l.type_ == "user").count();

    let mut parts = Vec::new();
    if system_count > 0 {
        parts.push(format!(
            "{system_count} system label{}",
            if system_count == 1 { "" } else { "s" }
        ));
    }
    if user_count > 0 {
        parts.push(format!(
            "{user_count} custom label{}",
            if user_count == 1 { "" } else { "s" }
        ));
    }

    format!("Found {}.", parts.join(" and "))
}
