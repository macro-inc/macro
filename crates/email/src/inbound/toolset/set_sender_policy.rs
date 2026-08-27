use crate::domain::{
    models::SenderPolicy,
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

use super::EmailToolContext;

/// Where future mail from this sender lands: `signal`, `noise`, or `block`.
#[derive(Debug, Deserialize, Serialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolSenderPolicy {
    /// Future mail from the sender appears in the Signal view.
    Signal,
    /// Future mail from the sender appears in the Noise view.
    Noise,
    /// Future mail from the sender is sent straight to trash.
    Block,
}

#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[schemars(
    title = "SetSenderPolicy",
    description = "\
Set where future mail from a sender lands in one of the user's inboxes. This is the \
same control a human has in the inbox menus: Sender → Signal, Sender → Noise, \
and Block Sender.\n\
\n\
Policies:\n\
- `signal`: the sender's future mail shows in the Signal view. Use for senders the \
user says are important.\n\
- `noise`: the sender's future mail shows in the Noise view. Mail still arrives and \
stays searchable. Use for newsletters, promos, and other low-value senders.\n\
- `block`: ALL future mail from the sender is sent straight to trash and never \
reaches the inbox. This is much stronger than noise. Only use it when the user \
explicitly asks to block a sender; when they just call mail unwanted or spammy, \
prefer `noise`.\n\
\n\
Policies are per inbox. When acting on a specific thread (e.g. after GetThread), \
pass `thread_id` so the policy applies to the inbox that owns that thread, which \
matters for delegated or secondary inboxes. Otherwise pass `inbox` (an inbox email \
address from ListInboxes) to name one, or omit both to use the primary inbox.\n\
\n\
Get `sender_email` from GetThread (`from.email`) or ListEntities (`sender_email`); \
do not guess addresses. Calling again with a different policy overwrites the \
previous one. Repeating a call with the same arguments is safe."
)]
/// Set where future mail from a sender lands in one inbox.
pub struct SetSenderPolicy {
    /// The sender's email address, e.g. `from.email` on a GetThread message or
    /// `sender_email` on a ListEntities email row. Exact address, not a domain.
    pub sender_email: String,
    /// Where future mail from this sender lands: `signal`, `noise`, or `block`.
    pub policy: ToolSenderPolicy,
    /// Apply the policy to the inbox that owns this thread (same UUID returned
    /// by ListEntities, search, or GetThread). Takes precedence over `inbox`.
    #[serde(default)]
    pub thread_id: Option<Uuid>,
    /// Apply the policy to a specific inbox by its email address (from
    /// ListInboxes). Ignored when `thread_id` is set. Omit both to use the
    /// primary inbox.
    #[serde(default)]
    pub inbox: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetSenderPolicyResponse {
    /// The sender the policy now applies to.
    pub sender_email: String,
    /// The policy that was applied.
    pub policy: ToolSenderPolicy,
    /// The email address of the inbox the policy was applied to.
    pub inbox: String,
    /// A human-readable summary of the change.
    pub summary: String,
}

impl ToolAnnotated for SetSenderPolicy {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Set sender policy").with_idempotent();
}

#[async_trait]
impl<T, G, E> AsyncTool<EmailToolContext<T, G, E>> for SetSenderPolicy
where
    T: EmailService,
    G: GmailTokenProvider,
    E: EntityAccessService,
{
    type Output = SetSenderPolicyResponse;

    #[tracing::instrument(skip_all, fields(
        user_id=?request_context.user_id,
        sender_email=%self.sender_email,
        policy=?self.policy,
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<EmailToolContext<T, G, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Set sender policy");

        let link = match self.thread_id {
            Some(thread_id) => service_context
                .service
                .get_owned_link_for_thread(
                    MacroUserIdStr((*request_context.user_id).clone()),
                    thread_id,
                )
                .await
                .map_err(|e| ToolCallError {
                    description: format!("Failed to resolve inbox for thread: {e}"),
                    internal_error: e.into(),
                })?
                .ok_or_else(|| ToolCallError {
                    description: "No accessible inbox owns this thread.".to_string(),
                    internal_error: anyhow::anyhow!("no owned link for thread"),
                })?,
            None => {
                let inboxes = service_context
                    .service
                    .get_inboxes_for_macro_id(MacroUserIdStr((*request_context.user_id).clone()))
                    .await
                    .map_err(|e| ToolCallError {
                        description: format!("Failed to resolve inboxes: {e}"),
                        internal_error: e.into(),
                    })?;
                let caller_macro_id = request_context.user_id.to_string();
                super::resolve_inbox_selector(&inboxes, &caller_macro_id, self.inbox.as_deref())?
                    .clone()
            }
        };

        let policy = match self.policy {
            ToolSenderPolicy::Signal => SenderPolicy::Signal,
            ToolSenderPolicy::Noise => SenderPolicy::Noise,
            ToolSenderPolicy::Block => SenderPolicy::Block,
        };

        service_context
            .service
            .set_sender_policy(&link, &self.sender_email, policy)
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to set sender policy: {e}"),
                internal_error: e.into(),
            })?;

        let sender_email = self.sender_email.trim().to_lowercase();
        let inbox = link.email_address.0.as_ref().to_string();
        let summary = match self.policy {
            ToolSenderPolicy::Signal => {
                format!("Messages from {sender_email} will now appear in Signal for {inbox}.")
            }
            ToolSenderPolicy::Noise => {
                format!("Messages from {sender_email} will now appear in Noise for {inbox}.")
            }
            ToolSenderPolicy::Block => {
                format!("All new messages from {sender_email} will be trashed for {inbox}.")
            }
        };

        Ok(SetSenderPolicyResponse {
            sender_email,
            policy: self.policy,
            inbox,
            summary,
        })
    }
}
