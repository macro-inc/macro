use crate::pubsub::context::PubSubContext;
use chrono::{DateTime, Utc};
use connection_gateway_client::client::ConnectionGatewayClient;
use email::domain::events::EmailMacroEvent;
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
/// shared utils across different pubsub workers
use models_email::api::refresh::RefreshEmailEvent;

#[cfg(test)]
mod test;
use models_email::email::service::backfill::{
    BackfillOperation, BackfillPubsubMessage, LinkScopedPayload, PopulateCrmContactPayload,
};
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use std::collections::HashSet;
use uuid::Uuid;

/// The macro users to notify about a link's inbox: its owner plus every primary
/// delegated to read it. Shared by the new-mail and reauth notification paths so
/// both fan out to the same recipients. Delegated primaries that fail to parse as
/// a macro user id are skipped.
pub fn build_notification_recipients(
    owner: &MacroUserIdStr<'static>,
    primaries: Vec<String>,
) -> HashSet<MacroUserIdStr<'static>> {
    let mut recipient_ids = HashSet::from([owner.clone()]);

    for primary in primaries {
        match MacroUserIdStr::try_from(primary) {
            Ok(id) => {
                recipient_ids.insert(id);
            }
            Err(e) => {
                tracing::warn!(
                    error=?e,
                    inbox_owner=%owner,
                    "skipping delegated primary that failed to parse as a macro user id"
                );
            }
        }
    }

    recipient_ids
}

/// One recipient tuple `(email, name, first_at, last_at)` fed into
/// [`enqueue_populate_crm_contacts`]. Per-message paths use the same
/// timestamp for both endpoints; the historical seed passes the
/// contact's pre-aggregated MIN/MAX.
pub type CrmContactRecipient = (String, Option<String>, DateTime<Utc>, DateTime<Utc>);

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

/// Publish an email event to the `macro.email` Kafka topic, logging and
/// dropping failures — event emission must never fail the email operation.
pub fn publish_email_event<B: MacroEventBroker>(broker: &B, event: &EmailMacroEvent) {
    let _ = broker
        .send_event(event)
        .inspect_err(|e| tracing::error!(error=?e, "failed to publish email macro event"));
}

/// Send message to connection gateway to trigger email refresh if user is active on FE
#[tracing::instrument(skip(client), level = "debug")]
pub async fn cg_refresh_email(
    client: &ConnectionGatewayClient,
    macro_id: &str,
    event: RefreshEmailEvent,
) {
    if cfg!(feature = "connection_gateway") {
        let payload = serde_json::to_value(&event).unwrap_or_default();
        let _ = client
            .refresh_email(macro_id, payload)
            .await
            .inspect_err(|e| tracing::error!(macro_id = %macro_id, "Failed to refresh email: {e}"));
    }
}

/// Signal every viewer of a connected inbox's calendars — the link owner
/// plus its delegated users — that the calendar projection changed. Best
/// effort: an inactive or unreachable viewer only misses a refresh nudge.
#[tracing::instrument(skip(client, db), level = "debug")]
pub async fn cg_refresh_calendar(
    client: &ConnectionGatewayClient,
    db: &sqlx::PgPool,
    owner_macro_id: &str,
    link_id: uuid::Uuid,
) {
    if !cfg!(feature = "connection_gateway") {
        return;
    }
    let payload = serde_json::to_value(
        calendar_events::domain::models::RefreshCalendarEvent::Synced { link_id },
    )
    .unwrap_or_default();
    let mut recipients = vec![owner_macro_id.to_string()];
    match sqlx::query_scalar!(
        "SELECT primary_macro_id FROM macro_user_links WHERE link_id = $1",
        link_id,
    )
    .fetch_all(db)
    .await
    {
        Ok(delegates) => recipients.extend(delegates),
        Err(error) => {
            tracing::warn!(error=?error, %link_id, "failed to resolve calendar refresh delegates");
        }
    }
    recipients.sort();
    recipients.dedup();
    for macro_id in recipients {
        let _ = client
            .refresh_calendar(&macro_id, payload.clone())
            .await
            .inspect_err(
                |e| tracing::error!(macro_id = %macro_id, "Failed to refresh calendar: {e}"),
            );
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
/// Takes `(email, name, first_at, last_at)` tuples. `name` comes from
/// the gmail message's recipient header on per-message paths and from
/// `email_contacts.name` on the historical path. `first_at` /
/// `last_at` carry the contact's known activity range — per-message
/// paths set both to `message.internal_date_ts`; the historical seed
/// sets them to MIN/MAX from its aggregating SQL.
///
/// `is_sent` flags whether the populating message was sent by the user
/// (true) or received (false). One fan-out batch is one direction;
/// callers that need to enqueue both (the historical seed) call this
/// helper twice. The consumer uses the flag to gate company INSERTs
/// and `first_interaction` LEAST-merging (received-direction never
/// creates a new `crm_companies` row and never moves
/// `first_interaction` backwards).
///
/// Email validation rules and dedup match
/// [`normalized_non_self_contact_emails`]; dedup is by email only, so the
/// first name / timestamps seen for a given address in this batch win.
pub async fn enqueue_populate_crm_contacts(
    ctx: &PubSubContext,
    link_id: Uuid,
    self_email: &str,
    contacts: impl IntoIterator<Item = CrmContactRecipient>,
    is_sent: bool,
) -> Result<(), ProcessingError> {
    let mut seen: HashSet<String> = HashSet::new();
    for (raw_email, contact_name, first_at, last_at) in contacts {
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
                    first_at,
                    last_at,
                    is_sent,
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

/// Producer-side dedupe for deferred CRM teardown when a message is deleted.
/// Uses the same [`normalized_non_self_contact_emails`] filter as the populate
/// helper, then upserts one `crm_cleanup_candidates` row per distinct contact.
/// The unique `(link_id, contact_email)` index collapses bulk deletes into a
/// single pending row; the nightly cleanup job sweeps the table and
/// depopulates contacts whose links no longer have messages with them.
pub async fn insert_crm_cleanup_candidates(
    ctx: &PubSubContext,
    link_id: Uuid,
    self_email: &str,
    contact_emails: impl IntoIterator<Item = String>,
) -> Result<(), ProcessingError> {
    let emails = normalized_non_self_contact_emails(self_email, contact_emails);

    email_db_client::crm_cleanup::candidates::insert_candidates(&ctx.db, link_id, &emails)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to insert crm cleanup candidates"),
            })
        })?;

    Ok(())
}
