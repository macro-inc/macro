use super::crm_contact::record_crm_population;
use super::*;
use crate::domain::crm_population::population_requests;
use crate::domain::mailbox::connection::ConnectionSourceError;
use models_email::service::{
    backfill::*,
    pubsub::{DetailedError, FailureReason, ProcessingError},
};
/// Requests recorded per ledger write while seeding a mailbox.
const SEED_BATCH: usize = 500;

/// Requests a population for every stored correspondent of the user's
/// explicitly consented primary mailbox. Each population rechecks consent and
/// exclusions.
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
        tracing::debug!("User has no team; skipping CRM seed");
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
        tracing::debug!("User has no consented mailbox; skipping CRM seed");
        return Ok(());
    };

    tracing::Span::current().record("team_id", tracing::field::display(team_id));
    tracing::Span::current().record("link_id", tracing::field::display(mailbox.link_id));
    let self_email = mailbox.email_address.to_ascii_lowercase();

    // The by_link queries aggregate MIN/MAX of `internal_date_ts` per
    // contact, so each request carries the contact's full known activity
    // range. The population recomputes the eligible range from stored
    // messages so stale requests and mixed-domain threads cannot bypass blocks.
    //
    // Sent recipients (`is_sent=true`, may create new `crm_companies` rows)
    // and received senders (`is_sent=false`, only updates already-tracked
    // rows) are requested separately; a correspondent in both merges into one
    // request in the ledger. A redelivered seed merges into the same requests.
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

    for (contacts, is_sent) in [(sent_recipients, true), (received_senders, false)] {
        let requests = population_requests(&self_email, contacts, is_sent);
        for batch in requests.chunks(SEED_BATCH) {
            record_crm_population(ctx, mailbox.link_id, batch).await?;
        }
    }
    Ok(())
}
