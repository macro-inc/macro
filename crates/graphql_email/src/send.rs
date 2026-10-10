//! GraphQL adapters for the email domain's replay-safe delivery capability.
use crate::mutation::{draft_input_from_graphql, draft_mutation_error};
use crate::{
    EmailThreadMutationOutput, GraphqlSoupEmailMessage, SaveEmailDraftInput,
    loaders::EmailContentMessage,
};
use async_graphql::{Context, Enum, ID, InputObject, Object};
use email::domain::send_attempt::{
    EmailSendService, SendAttempt, SendAttemptId, SendAttemptStatus, SendSnapshot,
};
use graphql_common::{parse_id, require_authenticated_user};
use macro_user_id::user_id::MacroUserIdStr;
use std::{marker::PhantomData, sync::Arc};

/// Identifies one send action independently of its server message identity.
#[derive(InputObject)]
pub struct EmailSendAttemptInput {
    /// Stable UUID generated for the explicit Send action.
    pub attempt_id: ID,
    /// Sending inbox captured at Send, never inferred during replay.
    pub link_id: ID,
}

/// Immutable content approved by the user.
#[derive(InputObject)]
pub struct SendEmailMessageInput {
    /// Stable attempt and sending inbox.
    pub attempt: EmailSendAttemptInput,
    /// Full message snapshot; scheduled time is ignored for immediate Send.
    pub message: SaveEmailDraftInput,
    /// Per-message signature preference.
    pub include_signature: Option<bool>,
    /// Completed draft attachment IDs.
    pub attachment_ids: Vec<ID>,
    /// Original attachment IDs for forwarded attachments.
    pub forwarded_attachment_ids: Vec<ID>,
    /// Editor HTML before the watermark, encoded like message HTML.
    pub restore_body_html: Option<String>,
    /// Editor plain text before the watermark.
    pub restore_body_text: Option<String>,
    /// Editor document before the watermark.
    pub restore_body_macro: Option<String>,
}

/// Authoritative delivery state; acceptance is not proof of provider delivery.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
pub enum EmailSendStatus {
    /// Durably accepted; preparation may be retried and cancellation remains safe.
    Accepted,
    /// Submission began, or a legacy claim has an unknown outcome; cancellation is unsafe.
    Sending,
    /// Delivery failed before acceptance; cancellation can restore the draft.
    Failed,
    /// Delivery may have occurred and is being reconciled without resending.
    DeliveryUnconfirmed,
    /// Provider delivery was recorded.
    Sent,
    /// This attempt cannot deliver.
    Cancelled,
}

/// Embedded attempt result; message identity belongs on its normalized message.
pub struct EmailSendAttemptPayload(pub(crate) SendAttempt);

/// Current result of one replay-safe send action.
#[Object]
impl EmailSendAttemptPayload {
    /// Stable send-action identity.
    async fn attempt_id(&self) -> ID {
        ID(self.0.attempt_id.0.to_string())
    }
    /// Current delivery state.
    async fn status(&self) -> EmailSendStatus {
        match self.0.status {
            SendAttemptStatus::Accepted => EmailSendStatus::Accepted,
            SendAttemptStatus::Sending => EmailSendStatus::Sending,
            SendAttemptStatus::Failed => EmailSendStatus::Failed,
            SendAttemptStatus::DeliveryUnconfirmed => EmailSendStatus::DeliveryUnconfirmed,
            SendAttemptStatus::Sent => EmailSendStatus::Sent,
            SendAttemptStatus::Cancelled => EmailSendStatus::Cancelled,
        }
    }
    /// First acceptance's delivery deadline, preserved across retries.
    async fn send_time(&self) -> Option<String> {
        self.0.send_time.map(|time| time.to_rfc3339())
    }
    /// Current message, absent if cancelled before admission or subsequently deleted.
    async fn message(&self) -> Option<GraphqlSoupEmailMessage> {
        self.0.message.clone().map(|message| {
            GraphqlSoupEmailMessage::from_content(EmailContentMessage::from(message))
        })
    }
    /// Server conversation identity, when admitted.
    async fn thread_id(&self) -> Option<ID> {
        self.0.thread_id.map(|id| ID(id.to_string()))
    }
}

/// Send admission and its canonical thread.
pub struct SendEmailMessagePayload<O: EmailThreadMutationOutput> {
    attempt: EmailSendAttemptPayload,
    thread: Option<O::Thread>,
}

/// Send admission or cancellation and the updated conversation.
#[Object(name = "SendEmailMessagePayload")]
impl<O: EmailThreadMutationOutput> SendEmailMessagePayload<O> {
    /// Admission/cancellation result and hydrated message.
    async fn attempt(&self) -> &EmailSendAttemptPayload {
        &self.attempt
    }
    /// Updated thread, absent for cancellation before admission.
    async fn thread(&self) -> Option<&O::Thread> {
        self.thread.as_ref()
    }
}

/// Independent mutation root for send/cancel operations.
pub struct GraphqlEmailSendMutation<S, O>(PhantomData<fn() -> (S, O)>);
impl<S, O> Default for GraphqlEmailSendMutation<S, O> {
    fn default() -> Self {
        Self(PhantomData)
    }
}

#[Object]
impl<S: EmailSendService + 'static, O: EmailThreadMutationOutput> GraphqlEmailSendMutation<S, O> {
    /// Durably accept an immutable send snapshot; safe to replay after response loss.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn send_email_message(
        &self,
        ctx: &Context<'_>,
        input: SendEmailMessageInput,
    ) -> async_graphql::Result<SendEmailMessagePayload<O>> {
        let actor = require_authenticated_user(ctx)?;
        let link = parse_id(input.attempt.link_id, "linkId")?;
        let attempt = SendAttemptId(parse_id(input.attempt.attempt_id, "attemptId")?);
        let mut message = draft_input_from_graphql(input.message)?;
        message.send_time = None;
        message.include_signature = input.include_signature;
        let snapshot = SendSnapshot {
            message,
            attachment_ids: input
                .attachment_ids
                .into_iter()
                .map(|id| parse_id(id, "attachmentId"))
                .collect::<Result<_, _>>()?,
            forwarded_attachment_ids: input
                .forwarded_attachment_ids
                .into_iter()
                .map(|id| parse_id(id, "attachmentId"))
                .collect::<Result<_, _>>()?,
            restore_body_html: input.restore_body_html,
            restore_body_text: input.restore_body_text,
            restore_body_macro: input.restore_body_macro,
        };
        let result = ctx
            .data::<Arc<S>>()?
            .send_email(actor.clone(), link, attempt, snapshot)
            .await
            .map_err(|error| draft_mutation_error(&error))?;
        payload::<O>(ctx, actor, result).await
    }

    /// Revoke delivery authority even if the original send request has not arrived.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn cancel_email_send(
        &self,
        ctx: &Context<'_>,
        input: EmailSendAttemptInput,
    ) -> async_graphql::Result<SendEmailMessagePayload<O>> {
        let actor = require_authenticated_user(ctx)?;
        let result = ctx
            .data::<Arc<S>>()?
            .cancel_email_send(
                actor.clone(),
                parse_id(input.link_id, "linkId")?,
                SendAttemptId(parse_id(input.attempt_id, "attemptId")?),
            )
            .await
            .map_err(|error| draft_mutation_error(&error))?;
        payload::<O>(ctx, actor, result).await
    }
}

async fn payload<O: EmailThreadMutationOutput>(
    ctx: &Context<'_>,
    actor: MacroUserIdStr<'static>,
    attempt: SendAttempt,
) -> async_graphql::Result<SendEmailMessagePayload<O>> {
    use async_graphql::ErrorExtensions;
    let thread = match attempt.thread_id {
        Some(id) => O::load_email_thread(ctx, actor, id)
            .await
            .map_err(|error| {
                error.extend_with(|_, ext| {
                    ext.set("retryable", true);
                    ext.set("code", "INTERNAL");
                })
            })?,
        None => None,
    };
    Ok(SendEmailMessagePayload {
        attempt: EmailSendAttemptPayload(attempt),
        thread,
    })
}

/// Resolve status on the authenticated viewer without resubmitting delivery.
pub async fn load_send_attempt<S: EmailSendService>(
    service: &S,
    actor: MacroUserIdStr<'static>,
    input: EmailSendAttemptInput,
) -> async_graphql::Result<Option<EmailSendAttemptPayload>> {
    service
        .email_send_status(
            actor,
            parse_id(input.link_id, "linkId")?,
            SendAttemptId(parse_id(input.attempt_id, "attemptId")?),
        )
        .await
        .map(|result| result.map(EmailSendAttemptPayload))
        .map_err(|error| draft_mutation_error(&error))
}

#[cfg(test)]
mod test;
