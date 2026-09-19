//! The MCP server's `SendEmail`: delivers immediately, with no composer to
//! review the draft, so it is gated on a per-inbox opt-in the user sets in
//! Macro settings (`email_settings.mcp_send_enabled`, off by default).

use crate::domain::ports::{EmailService, GmailTokenProvider};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    EmailToolContext,
    send_email::{EmailRecipient, OutgoingEmail, send_email},
};

/// Send an email immediately from one of the user's inboxes.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[schemars(
    title = "SendEmail",
    description = "\
Send an email immediately from the user's Macro inbox. There is no review step: the message \
is queued for delivery as soon as this call succeeds, so confirm the recipients, subject, and \
body with the user before calling it.\n\
\n\
Sending is off by default. It works only for an inbox where the user turned on agent sending \
in Macro Settings → Macro MCP server; otherwise the call fails and you should save the email \
with CreateEmailDraft instead, which the user then sends from Macro. Never retry a refused \
send with different arguments.\n\
\n\
To reply within an existing thread, pass `replying_to_id` (a message id from GetThread). Write \
the body in Markdown; it is rendered to HTML, and the inbox's signature is added per the user's \
settings. Sends from the primary inbox unless `inbox` names another inbox the user owns (an \
email address from ListInboxes); inboxes shared with the user by someone else cannot send."
)]
#[serde(rename_all = "camelCase")]
pub struct McpSendEmail {
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
    /// Message id to reply to (optional). When set, the email is sent as a
    /// reply in that message's thread.
    #[serde(default)]
    pub replying_to_id: Option<Uuid>,
    /// The inbox to send from, by email address (from ListInboxes). Omit to
    /// use the primary inbox.
    #[serde(default)]
    pub inbox: Option<String>,
}

/// Response from the MCP SendEmail tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct McpSendEmailResponse {
    /// The sent message's id.
    pub message_id: Uuid,
    /// The thread the message belongs to.
    pub thread_id: Uuid,
    /// The email address the message was sent from.
    pub inbox: String,
    /// A human-readable summary.
    pub summary: String,
}

impl ToolAnnotated for McpSendEmail {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Send email").with_open_world();
}

/// The refusal an MCP client sees when the inbox has not opted in.
pub(super) fn send_disabled_description(inbox: &str) -> String {
    format!(
        "Sending email from {inbox} is turned off for connected agents. The user can enable it \
         in Macro Settings → Macro MCP server. Save the email with CreateEmailDraft instead so \
         they can send it from Macro."
    )
}

#[async_trait]
impl<T, G, E> AsyncTool<EmailToolContext<T, G, E>> for McpSendEmail
where
    T: EmailService,
    G: GmailTokenProvider,
    E: EntityAccessService,
{
    type Output = McpSendEmailResponse;

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
        tracing::info!("Send email over MCP");

        let acting_user = MacroUserIdStr((*request_context.user_id).clone());
        let inboxes = service_context
            .service
            .get_inboxes_for_macro_id(acting_user.clone())
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to resolve inboxes: {e}"),
                internal_error: e.into(),
            })?;
        let caller_macro_id = request_context.user_id.to_string();
        let link =
            super::resolve_inbox_selector(&inboxes, &caller_macro_id, self.inbox.as_deref())?;
        // The opt-in is the owner's, for their own agents: a teammate the
        // inbox is delegated to must not ride on it.
        super::require_owned_inbox(link, &caller_macro_id)?;
        let inbox = link.email_address.0.as_ref().to_string();

        // Fail closed: a settings lookup error reads as "not enabled".
        let settings = service_context
            .service
            .get_email_settings(link)
            .await
            .map_err(|e| ToolCallError {
                description: send_disabled_description(&inbox),
                internal_error: e.into(),
            })?;
        if !settings.mcp_send_enabled {
            return Err(ToolCallError {
                description: send_disabled_description(&inbox),
                internal_error: anyhow::anyhow!("mcp send disabled for link {}", link.id),
            });
        }

        let sent = send_email(
            &service_context,
            acting_user,
            link,
            &inboxes,
            OutgoingEmail {
                subject: &self.subject,
                body: &self.body,
                to: &self.to,
                cc: &self.cc,
                bcc: &self.bcc,
                replying_to_id: self.replying_to_id,
                include_signature: None,
            },
        )
        .await?;

        Ok(McpSendEmailResponse {
            message_id: sent.db_id,
            thread_id: sent.thread_db_id,
            summary: format!("Sent \"{}\" from {inbox}.", self.subject),
            inbox,
        })
    }
}
