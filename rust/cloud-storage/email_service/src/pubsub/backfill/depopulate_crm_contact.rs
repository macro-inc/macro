use crate::pubsub::context::PubSubContext;
use crm::domain::service::CrmService;
use models_email::email::service::backfill::DepopulateCrmContactPayload;
use models_email::email::service::link;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Removes a contact from the CRM tables for one `(link, contact_email)`
/// when a sent message is deleted.
///
/// Fanned out one-per-recipient from `delete_message` in the inbox-sync
/// worker. The cascade is: drop the per-link `crm_contact_sources` row,
/// then `crm_contacts` if no other sources remain, then `crm_companies`
/// (with `crm_domains` falling out via FK cascade) if no other contacts
/// remain. See
/// [`crm::domain::companies_repo::CompaniesRepository::depopulate_contact`].
///
/// Pre-check: before invoking the CRM cascade we verify via
/// [`email_db_client::contacts::get::link_has_any_message_with`] that
/// this link no longer has any message (sent or received) involving
/// `contact_email`. Sources track interactions in both directions, so
/// the row must stay until both directions are gone. If a sibling
/// message still exists in either direction, we ack the job without
/// touching CRM — duplicate enqueues from retries or out-of-order
/// processing land here.
///
/// The check runs outside the CRM crate's advisory lock, so a brand-new
/// sent message landing in the microseconds between the check and the
/// cascade could see a transient deleted state; the populate path on
/// that new message re-creates the rows on its next run.
#[tracing::instrument(skip(ctx), err, fields(contact_email = %p.contact_email, link_id = %link.id))]
pub async fn depopulate_crm_contact(
    ctx: &PubSubContext,
    link: &link::Link,
    p: &DepopulateCrmContactPayload,
) -> Result<(), ProcessingError> {
    let macro_user_id = link.macro_id.to_string();

    let team_id = ctx
        .crm_service
        .get_team_id_for_user(&macro_user_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::from(e).context("Failed to look up team for link.macro_id"),
            })
        })?;

    let Some(team_id) = team_id else {
        tracing::debug!("User has no team; skipping CRM depopulation");
        return Ok(());
    };

    let still_has_any = email_db_client::contacts::get::link_has_any_message_with(
        &ctx.db,
        link.id,
        &p.contact_email,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to check remaining messages with contact"),
        })
    })?;

    if still_has_any {
        tracing::debug!(
            "Link still has other messages with contact (sent or received); skipping depopulation"
        );
        return Ok(());
    }

    ctx.crm_service
        .depopulate_contact(&team_id, &link.id, &p.contact_email)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::from(e).context("Failed to depopulate CRM contact"),
            })
        })?;

    Ok(())
}
