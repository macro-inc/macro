//! CreateDraft tool for composing a new email draft.

use crate::domain::{
    models::{ContactInfo, CreateDraftInput},
    ports::{EmailService, GmailTokenProvider},
};
use ai::tool::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::EmailToolContext;

/// A recipient for an email draft.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DraftRecipient {
    /// The recipient's email address.
    pub email: String,
    /// The recipient's display name (optional).
    #[serde(default)]
    pub name: Option<String>,
}

impl From<DraftRecipient> for ContactInfo {
    fn from(r: DraftRecipient) -> Self {
        ContactInfo {
            email: r.email,
            name: r.name,
            photo_url: None,
        }
    }
}

/// Create a new email draft. The draft is saved but NOT sent.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[schemars(
    title = "CreateDraft",
    description = "Create a new email draft that is saved but NOT sent. Use this to compose emails on behalf of the user. The user can review and send the draft themselves. To reply to an existing message, provide the replying_to_id. The body must be plain text only — do not use HTML, Markdown, or any formatting syntax (no **bold**, *italics*, headings, etc.). Just write natural prose with line breaks."
)]
#[serde(rename_all = "camelCase")]
pub struct CreateDraft {
    /// The subject line of the email.
    pub subject: String,
    /// The plain text body of the email.
    pub body: String,
    /// The primary recipients (To field).
    pub to: Vec<DraftRecipient>,
    /// Carbon copy recipients (optional).
    #[serde(default)]
    pub cc: Vec<DraftRecipient>,
    /// Blind carbon copy recipients (optional).
    #[serde(default)]
    pub bcc: Vec<DraftRecipient>,
    /// The ID of a message to reply to (optional). When set, the draft is
    /// created as a reply within the same thread.
    #[serde(default)]
    pub replying_to_id: Option<Uuid>,
}

/// Response from the CreateDraft tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDraftResponse {
    /// The database ID of the newly created draft.
    pub draft_id: Uuid,
    /// The thread ID the draft belongs to.
    pub thread_id: Uuid,
    /// A human-readable summary of the draft.
    pub summary: String,
}

#[async_trait]
impl<T, G, E> AsyncTool<EmailToolContext<T, G, E>> for CreateDraft
where
    T: EmailService,
    G: GmailTokenProvider,
    E: EntityAccessService,
{
    type Output = CreateDraftResponse;

    #[tracing::instrument(skip_all, fields(
        user_id=?request_context.user_id,
        subject=%self.subject,
        to_count=%self.to.len(),
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<EmailToolContext<T, G, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Create draft");

        let link = service_context
            .resolve_link(MacroUserIdStr((*request_context.user_id).clone()))
            .await?;

        let input = CreateDraftInput {
            db_id: None,
            provider_id: None,
            replying_to_id: self.replying_to_id,
            provider_thread_id: None,
            thread_db_id: None,
            subject: self.subject.clone(),
            to: self.to.iter().cloned().map(ContactInfo::from).collect(),
            cc: self.cc.iter().cloned().map(ContactInfo::from).collect(),
            bcc: self.bcc.iter().cloned().map(ContactInfo::from).collect(),
            body_text: Some(self.body.clone()),
            body_html: None,
            body_macro: None,
            headers_json: None,
            send_time: None,
        };

        let created = service_context
            .service
            .create_draft(&link, input)
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to create draft: {e}"),
                internal_error: e.into(),
            })?;

        let to_display: Vec<&str> = self.to.iter().map(|r| r.email.as_str()).collect();
        let reply_note = if self.replying_to_id.is_some() {
            " (reply)"
        } else {
            ""
        };
        let summary = format!(
            "Draft{reply_note} created with subject \"{}\" to {}.",
            self.subject,
            to_display.join(", ")
        );

        Ok(CreateDraftResponse {
            draft_id: created.db_id,
            thread_id: created.thread_db_id,
            summary,
        })
    }
}
