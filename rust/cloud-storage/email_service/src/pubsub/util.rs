use crate::pubsub::context::PubSubContext;
use crate::util::redis::RedisClient;
use crate::util::redis::rate_limit::RateLimitArgs;
use connection_gateway_client::client::ConnectionGatewayClient;
/// shared utils across different pubsub workers
use models_email::email::service::backfill::{
    BackfillOperation, BackfillPubsubMessage, DepopulateCrmContactPayload, LinkScopedPayload,
    PopulateCrmContactPayload,
};
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use models_email::gmail::operations::GmailApiOperation;
use std::collections::HashSet;
use uuid::Uuid;

/// Arguments for checking Gmail API rate limits
pub struct CheckGmailRateLimitArgs<'a> {
    pub redis_client: &'a RedisClient,
    pub link_id: Uuid,
    pub gmail_operation: GmailApiOperation,
    pub retryable: bool,
    pub is_backfill: bool,
}

// check if we are rate limited by gmail before making any requests to the api
pub async fn check_gmail_rate_limit(
    args: CheckGmailRateLimitArgs<'_>,
) -> Result<(), ProcessingError> {
    if args
        .redis_client
        .is_rate_limited(RateLimitArgs {
            user_id: args.link_id,
            operation: args.gmail_operation,
            is_backfill: args.is_backfill,
        })
        .await
    {
        return if args.retryable {
            Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiRateLimited,
                source: anyhow::Error::msg("Gmail API rate limit exceeded"),
            }))
        } else {
            Err(ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::GmailApiRateLimited,
                source: anyhow::Error::msg("Gmail API rate limit exceeded"),
            }))
        };
    }

    Ok(())
}

#[tracing::instrument(skip(tx, result), level = "debug")]
pub async fn complete_transaction_with_processing_error<T>(
    tx: sqlx::Transaction<'_, sqlx::Postgres>,
    result: Result<T, ProcessingError>,
) -> Result<T, ProcessingError> {
    match result {
        Ok(value) => {
            tx.commit().await.map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: anyhow::Error::from(e).context("Failed to commit transaction"),
                })
            })?;

            Ok(value)
        }
        Err(e) => match tx.rollback().await {
            Ok(_) => Err(e),
            Err(rollback_err) => {
                let combined_error = anyhow::anyhow!(
                    "Operation failed AND transaction rollback failed. Original error: {:?}, Rollback error: {:?}",
                    e,
                    rollback_err
                );

                Err(ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: combined_error,
                }))
            }
        },
    }
}

/// Send message to connection gateway to trigger email refresh if user is active on FE
#[tracing::instrument(skip(client), level = "debug")]
pub async fn cg_refresh_email(client: &ConnectionGatewayClient, macro_id: &str, event_type: &str) {
    if cfg!(feature = "connection_gateway") {
        let _ = client
            .refresh_email(macro_id, event_type)
            .await
            .inspect_err(|e| tracing::error!(macro_id = %macro_id, "Failed to refresh email: {e}"));
    }
}

/// Shared filter/dedup pass for the CRM populate + depopulate enqueue
/// helpers. Returns each input email, lowercased and trimmed, with
/// malformed addresses and the caller's own address dropped, and
/// duplicates collapsed.
///
/// Validation is stricter than a bare `contains('@')` check:
///   - must contain exactly one `@`
///   - local-part and domain must both be non-empty
///
/// Matches the validation in [`crm::domain::service::CrmService::populate_contact`]
/// so malformed inputs never reach the consumer side.
fn normalized_non_self_contact_emails(
    self_email: &str,
    contact_emails: impl IntoIterator<Item = String>,
) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    contact_emails
        .into_iter()
        .filter_map(|raw| {
            let email = raw.trim().to_ascii_lowercase();
            let (local, domain) = email.split_once('@')?;
            if local.is_empty() || domain.is_empty() || domain.contains('@') {
                return None;
            }
            if email == self_email || !seen.insert(email.clone()) {
                return None;
            }
            Some(email)
        })
        .collect()
}

/// Producer-side fan-out helper: normalizes and enqueues one
/// `PopulateCrmContact` message per distinct, non-self contact.
///
/// Takes `(email, name)` pairs so the consumer can write
/// `crm_contacts.name` without a follow-up round-trip to `email_contacts`.
/// `name` comes from the gmail message's recipient header on the
/// per-message paths (`backfill_message`, `upsert_message`) and from
/// `email_contacts.name` on the historical path (`populate_crm_for_user`).
///
/// Email validation rules and dedup match
/// [`normalized_non_self_contact_emails`]; dedup is by email only, so the
/// first name seen for a given address in this batch wins.
pub async fn enqueue_populate_crm_contacts(
    ctx: &PubSubContext,
    link_id: Uuid,
    self_email: &str,
    contacts: impl IntoIterator<Item = (String, Option<String>)>,
) -> Result<(), ProcessingError> {
    let mut seen: HashSet<String> = HashSet::new();
    for (raw_email, contact_name) in contacts {
        let contact_email = raw_email.trim().to_ascii_lowercase();
        let Some((local, domain)) = contact_email.split_once('@') else {
            continue;
        };
        if local.is_empty() || domain.is_empty() || domain.contains('@') {
            continue;
        }
        if contact_email == self_email || !seen.insert(contact_email.clone()) {
            continue;
        }

        let ps_message = BackfillPubsubMessage {
            backfill_operation: BackfillOperation::PopulateCrmContact(LinkScopedPayload {
                link_id,
                payload: PopulateCrmContactPayload {
                    contact_email,
                    contact_name,
                },
            }),
        };

        ctx.sqs_client
            .enqueue_email_backfill_message(ps_message)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context("Failed to enqueue PopulateCrmContact message"),
                })
            })?;
    }

    Ok(())
}

/// Producer-side fan-out helper for tearing CRM contacts down when a sent
/// message is deleted. Mirrors [`enqueue_populate_crm_contacts`] and uses
/// the same [`normalized_non_self_contact_emails`] filter.
///
/// Used by `delete_message` in the inbox-sync worker. The consumer
/// (`depopulate_crm_contact`) re-checks whether the link still has any
/// sent message to the contact before deleting, so duplicate enqueues
/// from retries are harmless.
pub async fn enqueue_depopulate_crm_contacts(
    ctx: &PubSubContext,
    link_id: Uuid,
    self_email: &str,
    contact_emails: impl IntoIterator<Item = String>,
) -> Result<(), ProcessingError> {
    for contact_email in normalized_non_self_contact_emails(self_email, contact_emails) {
        let ps_message = BackfillPubsubMessage {
            backfill_operation: BackfillOperation::DepopulateCrmContact(LinkScopedPayload {
                link_id,
                payload: DepopulateCrmContactPayload { contact_email },
            }),
        };

        ctx.sqs_client
            .enqueue_email_backfill_message(ps_message)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context("Failed to enqueue DepopulateCrmContact message"),
                })
            })?;
    }

    Ok(())
}
