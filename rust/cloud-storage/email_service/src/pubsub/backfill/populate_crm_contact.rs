use crate::pubsub::context::PubSubContext;
use crm::domain::service::CrmService;
use models_email::email::service::backfill::PopulateCrmContactPayload;
use models_email::email::service::link;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Idempotently records a contact the user has emailed into the CRM tables.
///
/// Fanned out one-per-recipient from `backfill_message` when the message was
/// sent by the user. Resolves the user's team (no-op if the user has no
/// team), then upserts `crm_companies`/`crm_domains`/`crm_contacts`/
/// `crm_contact_sources` atomically. A killswitch row
/// (`crm_companies.email_sync = false` for the contact's domain) is also a
/// no-op — see [`crm::domain::companies_repo::CompaniesRepository::populate_contact`].
///
/// Company metadata (name, description, icon) is resolved and cached
/// inside `crm_service.populate_contact` via the
/// `crm_domain_directory` lookup → resolver → upsert path, so the
/// consumer here doesn't need to know how that's done.
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
            &p.contact_email,
            p.contact_name.as_deref(),
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
