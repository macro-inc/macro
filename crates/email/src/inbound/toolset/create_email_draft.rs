//! CreateEmailDraft tool: saves an email as a draft in the user's inbox,
//! for hosts without a composer (the MCP server, the channel bot) where the
//! user finishes and sends the email in Macro.

use crate::domain::{
    models::{ContactInfo, CreateDraftInput},
    ports::{EmailService, GmailTokenProvider},
};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{EmailToolContext, send_email::EmailRecipient};

/// Save an email as a draft without sending it.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[schemars(
    title = "CreateEmailDraft",
    description = "\
Save an email as a draft in the user's Macro inbox without sending it. Use this whenever the \
user asks you to draft, write, prepare, or reply to an email: the draft appears in their inbox, \
where they review, edit, and send it themselves. Nothing is delivered by this tool.\n\
\n\
This is the default way to produce an email here. SendEmail delivers immediately and is off \
unless the user enabled agent sending for the inbox in Macro settings, so reach for \
CreateEmailDraft unless the user has explicitly asked you to send.\n\
\n\
To reply within an existing thread, pass `replying_to_id` (a message id from GetThread); the \
draft is placed in that thread. Write the body in Markdown — **bold**, *italics*, lists, and \
links are rendered when the user opens the draft. Recipients need an email address; a display \
name is optional. Returns the draft's `draftId` and its `threadId`, which is the thread the \
user opens in Macro to finish it.\n\
\n\
Drafts are saved in the user's primary inbox unless `inbox` names another connected inbox (an \
email address from ListInboxes)."
)]
#[serde(rename_all = "camelCase")]
pub struct CreateEmailDraft {
    /// The subject line.
    pub subject: String,
    /// The body, written as Markdown.
    pub body: String,
    /// The primary recipients (To).
    pub to: Vec<EmailRecipient>,
    /// Carbon copy recipients (optional).
    #[serde(default)]
    pub cc: Vec<EmailRecipient>,
    /// Blind carbon copy recipients (optional).
    #[serde(default)]
    pub bcc: Vec<EmailRecipient>,
    /// Message id to reply to (optional). When set, the draft is a reply in
    /// that message's thread.
    #[serde(default)]
    pub replying_to_id: Option<Uuid>,
    /// The inbox to save the draft in, by email address (from ListInboxes).
    /// Omit to use the primary inbox.
    #[serde(default)]
    pub inbox: Option<String>,
}

/// Response from the CreateEmailDraft tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateEmailDraftResponse {
    /// The saved draft's id.
    pub draft_id: Uuid,
    /// The thread the draft lives in; open `/app/email/<threadId>` in Macro
    /// to review and send it.
    pub thread_id: Uuid,
    /// The email address of the inbox the draft was saved in.
    pub inbox: String,
    /// A human-readable summary.
    pub summary: String,
}

impl ToolAnnotated for CreateEmailDraft {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Create email draft");
}

#[async_trait]
impl<T, G, E> AsyncTool<EmailToolContext<T, G, E>> for CreateEmailDraft
where
    T: EmailService,
    G: GmailTokenProvider,
    E: EntityAccessService,
{
    type Output = CreateEmailDraftResponse;

    #[tracing::instrument(skip_all, fields(
        user_id=?request_context.user_id,
        to_count=%self.to.len(),
        is_reply=%self.replying_to_id.is_some(),
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<EmailToolContext<T, G, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Create email draft");

        let inboxes = service_context
            .service
            .get_inboxes_for_macro_id(MacroUserIdStr((*request_context.user_id).clone()))
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to resolve inboxes: {e}"),
                internal_error: e.into(),
            })?;
        let caller_macro_id = request_context.user_id.to_string();
        let link =
            super::resolve_inbox_selector(&inboxes, &caller_macro_id, self.inbox.as_deref())?;

        let body = service_context.render_body(&self.body).await?;

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
            body_text: body.text,
            body_html: Some(body.html),
            body_macro: None,
            headers_json: None,
            send_time: None,
            // Signature policy is applied when the user sends from Macro.
            include_signature: None,
            actor: None,
        };

        let draft = service_context
            .service
            .create_draft(link, &inboxes, input)
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to save the draft: {e}"),
                internal_error: e.into(),
            })?;

        let inbox = link.email_address.0.as_ref().to_string();
        Ok(CreateEmailDraftResponse {
            draft_id: draft.db_id,
            thread_id: draft.thread_db_id,
            summary: format!(
                "Saved a draft \"{}\" in {inbox}. The user can review and send it from Macro.",
                self.subject
            ),
            inbox,
        })
    }
}
