//! SendEmail tool for composing and sending an email in one step.

use crate::domain::{
    models::{ContactInfo, CreateDraftInput, SendingInboxRequest},
    ports::{EmailService, GmailTokenProvider},
};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::{models::ViewAccessLevel, ports::EntityAccessService};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::EmailToolContext;

/// A recipient for an email.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EmailRecipient {
    /// The recipient's email address.
    pub email: String,
    /// The recipient's display name (optional).
    #[serde(default)]
    pub name: Option<String>,
}

impl From<EmailRecipient> for ContactInfo {
    fn from(r: EmailRecipient) -> Self {
        ContactInfo {
            email: r.email,
            name: r.name,
            photo_url: None,
        }
    }
}

/// A Macro document attached to an outgoing email as a file.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EmailAttachment {
    /// The id of the Macro document to attach. It must be a stored file -
    /// an uploaded PDF, image, spreadsheet, Word document, or other upload -
    /// that the user can view. A Macro-native document (one written in the
    /// editor) has no file to attach; link to it in the body instead.
    pub document_id: Uuid,
}

/// Compose and send an email. Creates a draft and immediately queues it for delivery.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[schemars(
    title = "SendEmail",
    description = "Draft, compose, and send an email the user confirms in a review card or composer. Use this tool whenever the user asks you to draft, write, compose, or send an email (or reply to one) from the agent session view or from chat — never write the email as plain text there. It opens the draft for the user to review, edit, and confirm before it is sent, so it is the correct tool even when the user only wants a draft. Do NOT use it for a prompt that came from a channel or document thread — the context block names a conversation parent when it did, and there is no surface to review a draft in: write the email out in your reply, ask whether to send it, and use SendConfirmedEmail once the user approves. To reply to an existing message, provide the replying_to_id; the reply then goes out from the inbox that received it unless `from` says otherwise. To attach files, list the Macro documents in attachments — uploaded files such as PDFs, images, spreadsheets, or Word documents the user can view; the user can add or remove attachments in the composer before sending. Write the body in Markdown — use **bold**, *italics*, lists, links, and other standard Markdown formatting. The draft composer renders the Markdown for the user to review and edit; the composer produces HTML that is sent as the actual email body."
)]
#[serde(rename_all = "camelCase")]
pub struct SendEmail {
    /// The subject line of the email.
    pub subject: String,
    /// The address of the inbox to send from, when the user has more than one
    /// connected and this email belongs to a particular one. Use the exact
    /// `emailAddress` of a connected inbox — `ListInboxes` lists them, and
    /// `GetThread` reports the `inbox` a thread belongs to. Omit it unless
    /// you know which inbox is right: a reply then goes out from the inbox
    /// that received the message it answers, and a new email from the user's
    /// primary inbox. The user can change it in the composer either way.
    #[serde(default)]
    pub from: Option<String>,
    /// The body of the email, written as Markdown. A host with a composer
    /// (chat) replaces this with the base64url-encoded HTML the composer
    /// exported before the tool runs; a host without one (an agent session)
    /// leaves the Markdown, and this tool renders it the same way.
    pub body: String,
    /// The primary recipients (To field).
    pub to: Vec<EmailRecipient>,
    /// Carbon copy recipients (optional).
    #[serde(default)]
    pub cc: Vec<EmailRecipient>,
    /// Blind carbon copy recipients (optional).
    #[serde(default)]
    pub bcc: Vec<EmailRecipient>,
    /// The ID of a message to reply to (optional). When set, the email is
    /// sent as a reply within the same thread.
    #[serde(default)]
    pub replying_to_id: Option<Uuid>,
    /// Per-message signature override, set by the composer's signature preview —
    /// not normally by you. Omit to use the inbox's default policy (always on a
    /// new email; on replies/forwards only when the user enabled it). `false`
    /// excludes the signature for this one email.
    #[serde(default)]
    pub include_signature: Option<bool>,
    /// Macro documents to attach as files (optional). Each must be an
    /// uploaded file the user can view; together they may total 18 MB.
    #[serde(default)]
    pub attachments: Vec<EmailAttachment>,
}

/// Response from the SendEmail tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SendEmailResponse {
    Sent {
        /// The database ID of the sent message.
        message_id: Uuid,
        /// The thread ID the message belongs to.
        thread_id: Uuid,
    },
    ConvertedToDraft {
        draft_id: Uuid,
    },
    UserEdited,
}

impl ToolAnnotated for SendEmail {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Send email").with_open_world();
}

#[async_trait]
impl<T, G, E> AsyncTool<EmailToolContext<T, G, E>> for SendEmail
where
    T: EmailService,
    G: GmailTokenProvider,
    E: EntityAccessService,
{
    type Output = SendEmailResponse;

    #[tracing::instrument(skip_all, fields(
        user_id=?request_context.user_id,
        subject=%self.subject,
        to_count=%self.to.len(),
        attachment_count=%self.attachments.len(),
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<EmailToolContext<T, G, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let acting_user = MacroUserIdStr((*request_context.user_id).clone());
        let sender = service_context
            .resolve_sending_inbox(
                acting_user.clone(),
                SendingInboxRequest {
                    requested_address: self.from.as_deref(),
                    replying_to_id: self.replying_to_id,
                },
            )
            .await?;

        let body = service_context.render_body(&self.body).await?;

        let mut attachments = Vec::with_capacity(self.attachments.len());
        for attachment in &self.attachments {
            let receipt = service_context
                .entity_access_service
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    &request_context.user_id,
                    None,
                    &attachment.document_id.to_string(),
                    EntityType::Document,
                )
                .await
                .map_err(|e| ToolCallError {
                    description: format!("Cannot attach document {}: {e}", attachment.document_id),
                    internal_error: e.into(),
                })?;
            attachments.push(receipt);
        }

        let input = CreateDraftInput {
            sender_email: None,
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
            // Composer override when present; otherwise None lets the backend
            // apply the default signature policy.
            include_signature: self.include_signature,
            actor: Some(acting_user),
            draft_client_binding: None,
            thread_client_binding: None,
        };

        // The whole accessible set, not just the sending inbox: a reply's
        // target may live in another of the user's inboxes, and the send has
        // to be able to find it to thread (or reference) the reply.
        let sent = service_context
            .attachment_sender
            .send_message_with_attachments(
                &sender.link,
                &sender.accessible_inboxes,
                input,
                attachments,
            )
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to send email: {e}"),
                internal_error: e.into(),
            })?;

        Ok(SendEmailResponse::Sent {
            message_id: sent.db_id,
            thread_id: sent.thread_db_id,
        })
    }
}
