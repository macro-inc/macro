use std::collections::HashSet;

use crate::pubsub::backfill::email_api_error::map_email_api_error;
use crate::pubsub::context::PubSubContext;
use contacts::domain::ports::ContactsIngress;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::email::service::backfill::{JobScopedPayload, SeedSentContactPayload};
use models_email::email::service::link;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Consumer for `BackfillOperation::SeedSentContact`. Fetches one recent sent
/// message and enqueues a sender<->recipient contact connection for every
/// non-generic To/Cc/Bcc address on it. Fanned out one-per-message by the
/// priority pass of `list_threads` so a new user has contacts before full
/// backfill completes.
///
/// Each connection is enqueued as a 2-element set (`{owner, recipient}`) rather
/// than the whole recipient list, so the contacts service connects the sender
/// to each recipient only — not the recipients to each other.
#[tracing::instrument(skip(ctx))]
pub async fn seed_sent_contact(
    ctx: &PubSubContext,
    scope: &JobScopedPayload<SeedSentContactPayload>,
    link: &link::Link,
) -> Result<(), ProcessingError> {
    let p = &scope.payload;

    let Some(fetched) = ctx
        .email_api
        .get_message(link.id, &p.message_provider_id)
        .await
        .map_err(|error| {
            map_email_api_error(error, "Failed to get sent message for contact seed")
        })?
    else {
        // The message was deleted between listing and this fetch; nothing to seed.
        return Ok(());
    };
    let message = fetched.message;

    let self_email = link.email_address.0.as_ref().to_ascii_lowercase();

    // Recipients the user addressed on this sent message. Generic/automated
    // addresses are dropped, the user's own address is dropped, and we dedupe
    // so a recipient on both To and Cc only yields one connection.
    let mut seen: HashSet<String> = HashSet::new();
    for contact in message.to.iter().chain(&message.cc).chain(&message.bcc) {
        let email = contact.email.trim().to_ascii_lowercase();
        if email.is_empty()
            || email == self_email
            || email_utils::is_generic_email(&email)
            || !seen.insert(email.clone())
        {
            continue;
        }

        let recipient = match MacroUserIdStr::try_from_email(&email) {
            Ok(id) => id,
            // A single malformed address shouldn't fail the whole message.
            Err(e) => {
                tracing::warn!(error = ?e, "Skipping invalid recipient email for contact seed");
                continue;
            }
        };

        let users: HashSet<MacroUserIdStr<'static>> =
            HashSet::from([link.macro_id.clone(), recipient]);

        // Idempotent on the consumer side, so a retried seed message that
        // re-enqueues already-sent connections is harmless.
        ctx.contacts_ingress
            .enqueue_contacts(users)
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: anyhow::anyhow!("{e:?}")
                        .context("Failed to enqueue contact connection for sent-message seed"),
                })
            })?;
    }

    Ok(())
}
