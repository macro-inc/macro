use crate::pubsub::context::PubSubContext;
use crm::domain::service::CrmService;
use models_email::email::service::backfill::PopulateCrmContactPayload;
use models_email::email::service::link;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Records a CRM interaction for one `(link, contact_email)` —
/// possibly inserting new `crm_companies` / `crm_contacts` /
/// `crm_contact_sources` rows.
///
/// Fanned out one-per-address from `backfill_message`, `upsert_message`,
/// and `populate_crm_for_user`. Every non-draft message contributes:
/// sent-direction populates fan out per to/cc/bcc recipient and may
/// insert new company rows; received-direction populates fan out for
/// the sender and only touch already-tracked companies. The consumer
/// resolves the team for the link (no-op if no team), then delegates
/// to [`crm::domain::service::CrmService::populate_contact`] which
/// applies the full insert / update matrix.
///
/// `first_at` / `last_at` come from the producer pre-computed. Per-
/// message paths set both to the message's `internal_date_ts` (with
/// `Utc::now()` fallback at the producer when Gmail returned none).
/// The historical seed aggregates MIN/MAX per contact in SQL.
#[tracing::instrument(skip(ctx), err, fields(contact_email = %p.contact_email, link_id = %link.id))]
pub async fn populate_crm_contact(
    ctx: &PubSubContext,
    link: &link::Link,
    p: &PopulateCrmContactPayload,
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
        tracing::debug!("User has no team; skipping CRM population");
        return Ok(());
    };

    ctx.crm_service
        .populate_contact(
            &team_id,
            &link.id,
            link.email_address.0.as_ref(),
            &p.contact_email,
            p.contact_name.as_deref(),
            p.first_at,
            p.last_at,
            p.is_sent,
        )
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::from(e).context("Failed to populate CRM contact"),
            })
        })?;

    Ok(())
}
