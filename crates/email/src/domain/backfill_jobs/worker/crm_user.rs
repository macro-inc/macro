use super::*;
use crate::domain::mailbox::connection::ConnectionSourceError;
use crate::domain::mailbox::inbox_sync::crm_contact_requests;
use models_email::service::{
    backfill::*,
    pubsub::{DetailedError, FailureReason, ProcessingError},
};
/// Fans out historical contacts only for the user's explicitly consented
/// primary mailbox. Consent and exclusions are rechecked by each contact job.
/// Requests go out in batches, so a large mailbox's history never needs one
/// message per contact at once.
///
/// Stale requests after withdrawal, account switching, or team removal no-op.
#[tracing::instrument(skip_all, err, fields(team_id, link_id))]
pub(super) async fn populate_crm_for_user<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    payload: &PopulateCrmForUserPayload,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let macro_id_str = payload.macro_id.0.as_ref();
    let team_id = ctx
        .crm
        .get_team_id_for_user(macro_id_str)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::from(e).context("Failed to look up team for macro_id"),
            })
        })?;

    let Some(team_id) = team_id else {
        tracing::debug!("User has no team; skipping CRM fan-out");
        return Ok(());
    };

    let mailbox = ctx
        .crm
        .contribution_mailbox(team_id, macro_id_str)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::from(e).context("Failed to resolve CRM email consent"),
            })
        })?;
    let Some(mailbox) = mailbox else {
        tracing::debug!("User has no consented mailbox; skipping CRM fan-out");
        return Ok(());
    };

    tracing::Span::current().record("team_id", tracing::field::display(team_id));
    tracing::Span::current().record("link_id", tracing::field::display(mailbox.link_id));
    let self_email = mailbox.email_address.to_ascii_lowercase();

    // The by_link queries aggregate MIN/MAX of `internal_date_ts` per
    // contact, so each fan-out job carries the contact's full known
    // activity range. The consumer recomputes the eligible range from stored
    // messages so stale jobs and mixed-domain threads cannot bypass blocks.
    //
    // Two fan-outs: sent recipients (`is_sent=true`, may create new
    // `crm_companies` rows), then received senders (`is_sent=false`,
    // only updates already-tracked rows). Sent first so received-pass
    // contacts at brand-new companies can also land. Both passes are
    // idempotent.
    let sent_recipients = ctx
        .repository
        .sent_contacts(mailbox.link_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to fetch sent-message recipients"),
            })
        })?;

    request_history(
        ctx,
        mailbox.link_id,
        crm_contact_requests(&self_email, sent_recipients, true, false),
    )
    .await?;

    let received_senders = ctx
        .repository
        .received_contacts(mailbox.link_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to fetch received-message senders"),
            })
        })?;

    request_history(
        ctx,
        mailbox.link_id,
        crm_contact_requests(&self_email, received_senders, false, false),
    )
    .await
}

/// Contacts per population request, so a mailbox's history goes out in
/// bounded batches.
const HISTORY_REQUEST_BATCH: usize = 500;

async fn request_history<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link_id: uuid::Uuid,
    requests: Vec<PopulateCrmContactPayload>,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    for batch in requests.chunks(HISTORY_REQUEST_BATCH) {
        super::message::request_crm_populations(ctx, link_id, batch.to_vec()).await?;
    }
    Ok(())
}
