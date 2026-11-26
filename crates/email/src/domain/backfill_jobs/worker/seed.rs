use super::email_api_error::map_email_api_error;
use super::*;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::{
    backfill::*,
    link,
    pubsub::{DetailedError, FailureReason, ProcessingError},
};
use std::collections::HashSet;
/// Consumer for `BackfillOperation::SeedSentContact`. Fetches one recent sent
/// message and records every non-generic To/Cc/Bcc address on it as known to
/// the owner through this inbox. Fanned out one-per-message by the priority
/// pass of `list_threads` so a new user has contacts before full backfill
/// completes.
///
/// The record is directed, owner to each recipient: the recipients gain
/// nobody, and are not connected to each other.
#[tracing::instrument(skip(ctx))]
pub(super) async fn seed_sent_contact<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    scope: &JobScopedPayload<SeedSentContactPayload>,
    link: &link::Link,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let p = &scope.payload;

    let Some(fetched) = ctx
        .gmail
        .message(link.id, &p.message_provider_id)
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
    // so a recipient on both To and Cc is recorded once.
    let mut seen: HashSet<String> = HashSet::new();
    let mut recipients = Vec::new();
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
            // A single malformed address shouldn't fail the whole message. The
            // parse error quotes its input, an address, so it stays out of the log.
            Err(_) => {
                tracing::warn!("Skipping invalid recipient email for contact seed");
                continue;
            }
        };

        recipients.push(recipient);
    }
    if recipients.is_empty() {
        return Ok(());
    }

    // Idempotent on the consumer side, so a retried seed message that
    // re-enqueues already-recorded contacts is harmless.
    ctx.effects.connect(link, recipients).await.map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::SqsEnqueueFailed,
            source: anyhow::anyhow!("{e:?}")
                .context("Failed to enqueue contact connection for sent-message seed"),
        })
    })?;

    Ok(())
}
