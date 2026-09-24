//! `SendConfirmedEmail`: [`SendEmail`] without the review, for a host that
//! has nothing to review in.
//!
//! `SendEmail` defers: it returns `PendingUserExecution` and a host finishes
//! it - the chat composer after the turn, or a review-card elicitation in an
//! agent-session turn. A prompt read out of a channel or document thread has
//! neither surface, so the agent asks in prose there, the user answers in the
//! thread, and this tool sends on that answer. Every host gets both tools;
//! the prompt, not the toolset, says which to reach for.
//!
//! The gate is `userConfirmation`: the model must quote the user's approving
//! message to call this. That is a cheap first pass, deliberately - it makes
//! the model produce evidence rather than send silently, and the requirement
//! is self-documenting in the schema - but nothing here checks the quote
//! against the thread, so it is not a guarantee. Session-scoped proposal
//! state that could verify it was considered and deferred.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::Deserialize;

use super::EmailToolContext;
use super::send_email::{SendEmail, SendEmailResponse};
use crate::domain::ports::{EmailService, GmailTokenProvider};

/// Send an email the user has already approved in conversation.
///
/// The fields are [`SendEmail`]'s, flattened, plus the confirmation; the
/// sending is [`SendEmail`]'s too. The two tools differ in whether a host
/// reviews the call, not in what a send is.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[schemars(
    title = "SendConfirmedEmail",
    description = "Send an email immediately, with no review card or composer. Only for a prompt that came from a channel or document thread (the context block says so), where there is nothing to review a draft in: describe the email to the user in prose there, ask whether to send it, wait for their reply, and call this tool only once they have approved that specific email - quoting their approving message in userConfirmation. Never call it without one, and never call it in the agent session view or in chat: use SendEmail there, whose review card or composer is the confirmation. Takes the same fields as SendEmail; write the body in Markdown, which is rendered to HTML on send."
)]
#[serde(rename_all = "camelCase")]
pub struct SendConfirmedEmail {
    /// The email, exactly as `SendEmail` takes it.
    #[serde(flatten)]
    pub email: SendEmail,
    /// The user's own words approving this send.
    #[schemars(
        description = "The user's own message approving this specific email, quoted verbatim - for example their \"yes, send it\" after you described the email in prose. Required: do not call this tool without one, do not paraphrase it, and never supply it yourself."
    )]
    pub user_confirmation: String,
}

impl ToolAnnotated for SendConfirmedEmail {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Send confirmed email").with_open_world();
}

#[async_trait]
impl<T, G, E> AsyncTool<EmailToolContext<T, G, E>> for SendConfirmedEmail
where
    T: EmailService,
    G: GmailTokenProvider,
    E: EntityAccessService,
{
    type Output = SendEmailResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<EmailToolContext<T, G, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        // The schema makes the field required, so a call gets here with one;
        // a blank one is the model going through the motions, and is refused
        // the same way a missing one would be.
        if self.user_confirmation.trim().is_empty() {
            return Err(ToolCallError {
                description: "SendConfirmedEmail requires the user's own message approving this email in userConfirmation. Describe the email in prose, ask whether to send it, and call this tool only after they say yes.".to_owned(),
                internal_error: anyhow::anyhow!("SendConfirmedEmail called without a confirmation"),
            });
        }
        self.email.call(service_context, request_context).await
    }
}
