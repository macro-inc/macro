use async_graphql::{InputObject, SimpleObject};

use super::*;

/// Online delivery command. The draft handle is required so a response lost
/// after enqueue cannot turn a retry into a second, unrelated message.
#[derive(InputObject)]
pub struct SendEmailMessageInput {
    /// Complete latest draft revision, including inbox and sender address.
    pub draft: SaveEmailDraftInput,
    /// Per-message override for the inbox's signature policy.
    pub include_signature: Option<bool>,
}

/// Confirmed delivery identity. These fields describe an operation result, not
/// a globally normalized entity; there is deliberately no `id` field.
#[derive(SimpleObject)]
pub struct SendEmailMessagePayload {
    /// Persisted message queued for delivery.
    message_id: ID,
    /// Persisted thread containing the message.
    thread_id: ID,
    /// Authorized inbox used for delivery.
    link_id: ID,
    /// End of the undo-send window, in RFC 3339 format.
    send_time: Option<String>,
}

pub(super) async fn send<S: EmailMutationService>(
    ctx: &Context<'_>,
    input: SendEmailMessageInput,
) -> async_graphql::Result<SendEmailMessagePayload> {
    let user_id = require_authenticated_user(ctx)?;
    let link_id = input
        .draft
        .link_id
        .clone()
        .map(|id| parse_id(id, "linkId"))
        .transpose()?;
    let mut draft = draft_input_from_graphql(input.draft)?;
    draft.include_signature = input.include_signature;
    let sent = ctx
        .data::<Arc<S>>()?
        .send_email_message(user_id, link_id, draft)
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "failed to enqueue email delivery");
            draft_mutation_error(&error)
        })?;
    // Do not perform fallible hydration after committing delivery. A read
    // failure must not make a successful send appear safe to repeat.
    Ok(SendEmailMessagePayload {
        message_id: ID(sent.db_id.to_string()),
        thread_id: ID(sent.thread_db_id.to_string()),
        link_id: ID(sent.link_id.to_string()),
        send_time: sent.send_time.map(|time| time.to_rfc3339()),
    })
}
