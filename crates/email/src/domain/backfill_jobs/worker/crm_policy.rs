use super::*;
use ::crm::domain::model::CrmError;
use models_email::service::{backfill::PopulateCrmPolicyPayload, pubsub::FailureReason};

/// No child fan-out: completing a page means every contact effect is durable.
#[tracing::instrument(name = "crm.email_history.consume", skip_all, fields(team_id = %payload.team_id, work_id = %payload.work_id), err)]
pub(super) async fn populate_policy_page<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    payload: &PopulateCrmPolicyPayload,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let slot = admit_crm_slot(ctx.effects.acquire_crm(payload.team_id).await)?;
    slot.hold(async {
        let Some(page) = ctx.crm.policy_history_page(payload).await? else {
            return Ok(());
        };
        for contact in &page.contacts {
            ctx.crm
                .populate_policy_contact(payload, &page, contact)
                .await?;
        }
        ctx.crm.finish_policy_history_page(payload, &page).await
    })
    .await
    .map_err(|error: CrmError| {
        ProcessingError::Retryable(DetailedError {
            reason: if matches!(error, CrmError::Contended) {
                FailureReason::BackfillWritesBusy
            } else {
                FailureReason::DatabaseQueryFailed
            },
            source: anyhow::Error::from(error).context("CRM policy history page failed"),
        })
    })
}
