use super::{
    CrmServiceImpl,
    email_policy_api::{canonical_rules, validate_targets},
};
use crate::domain::{
    auth::CrmTeamReceipt, companies_repo::CompaniesRepository,
    company_metadata_resolver::CompanyMetadataResolver, email_policy::EmailPolicyPreviewStatus,
    email_policy_api::EmailPolicyAuthoringRepository, email_policy_preview::*, model::CrmError,
};
use chrono::Utc;
use entity_access::domain::models::MemberTeamRole;
use uuid::Uuid;

impl<CR, R> EmailPreviewService for CrmServiceImpl<CR, R>
where
    CR: CompaniesRepository + EmailPolicyAuthoringRepository + EmailPreviewRepository,
    R: CompanyMetadataResolver,
{
    #[tracing::instrument(skip_all,fields(team_id=%access.team_id()),err)]
    async fn preview_email_rules(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        mut input: EmailPreviewRequest,
    ) -> Result<EmailPreviewView, CrmError> {
        let user = access
            .receipt()
            .get_authenticated_user()
            .map_err(|_| CrmError::AccessDenied)?;
        if !self.selective_email_available(user.clone()).await {
            return Err(CrmError::SelectiveEmailUnavailable);
        }
        input.rules = canonical_rules(input.rules)?;
        let observed = self
            .companies_repository
            .inspect_email_policy(access.team_id(), user.as_ref())
            .await?;
        let (Some(link), Some(mailbox)) = (observed.link_id, observed.mailbox_email) else {
            return Err(CrmError::EmailPolicyConflict);
        };
        let facts = self
            .companies_repository
            .email_rule_targets(access.team_id(), user.as_ref(), link, &input.rules.include)
            .await?;
        input.rules = validate_targets(input.rules, facts, &mailbox)?.rules;
        self.companies_repository
            .start_email_preview(access.team_id(), user.as_ref(), &input)
            .await
    }
    #[tracing::instrument(skip_all,fields(team_id=%access.team_id()),err)]
    async fn email_rule_preview(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<Option<EmailPreviewView>, CrmError> {
        let user = access
            .receipt()
            .get_authenticated_user()
            .map_err(|_| CrmError::AccessDenied)?;
        self.companies_repository
            .email_preview(access.team_id(), user.as_ref())
            .await
    }
    #[tracing::instrument(skip_all,fields(team_id=%access.team_id(),preview_id=%preview_id),err)]
    async fn cancel_email_rule_preview(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        preview_id: Uuid,
    ) -> Result<(), CrmError> {
        let user = access
            .receipt()
            .get_authenticated_user()
            .map_err(|_| CrmError::AccessDenied)?;
        self.companies_repository
            .cancel_email_preview(access.team_id(), user.as_ref(), preview_id)
            .await
    }
}

impl<CR, R> EmailPreviewWorkService for CrmServiceImpl<CR, R>
where
    CR: CompaniesRepository + EmailPreviewRepository,
    R: CompanyMetadataResolver,
{
    async fn process_email_preview(&self) -> Result<bool, CrmError> {
        use tracing::Instrument;
        let Some(job) = self.companies_repository.claim_email_preview().await? else {
            return Ok(false);
        };
        let span = tracing::info_span!("crm.email_policy.preview",team_id=%job.team_id,preview_id=%job.view.preview_id,outcome=tracing::field::Empty);
        self.companies_repository.adopt_preview_trace(&job, &span);
        let result = async {
            let mut view = job.view.clone();
            if view.expires_at <= Utc::now() {
                view.status = EmailPolicyPreviewStatus::Partial;
                self.companies_repository
                    .finish_email_preview(&job, &view)
                    .await?;
                tracing::Span::current().record("outcome", "expired");
                return Ok(true);
            }
            let Some(mut snapshot) = self.companies_repository.open_email_preview(&job).await?
            else {
                view.status = EmailPolicyPreviewStatus::Stale;
                self.companies_repository
                    .finish_email_preview(&job, &view)
                    .await?;
                tracing::Span::current().record("outcome", "stale");
                return Ok(true);
            };
            view.as_of = Some(snapshot.as_of());
            let started = std::time::Instant::now();
            loop {
                let remaining = (view.expires_at - Utc::now())
                    .num_milliseconds()
                    .min(300_000 - i64::try_from(started.elapsed().as_millis()).unwrap_or(300_000));
                if remaining <= 0 || view.scanned_threads >= 10_000 {
                    view.status = EmailPolicyPreviewStatus::Partial;
                    break;
                }
                let page = match snapshot
                    .next_page(
                        u32::try_from(remaining.min(15_000))
                            .map_err(|_| CrmError::EmailPreviewBudgetExhausted)?,
                    )
                    .await
                {
                    Ok(page) => page,
                    Err(CrmError::EmailPreviewBudgetExhausted) => {
                        view.status = EmailPolicyPreviewStatus::Partial;
                        break;
                    }
                    Err(error) => return Err(error),
                };
                view.scanned_threads += page.scanned_threads;
                view.counts.current += page.counts.current;
                view.counts.proposed += page.counts.proposed;
                view.counts.added += page.counts.added;
                view.counts.removed += page.counts.removed;
                view.counts.retained += page.counts.retained;
                view.counts.denied += page.counts.denied;
                if page.scanned_threads < 100 {
                    view.status = EmailPolicyPreviewStatus::Complete;
                    break;
                }
                if view.scanned_threads % 1000 == 0
                    && !self
                        .companies_repository
                        .finish_email_preview(&job, &view)
                        .await?
                {
                    tracing::Span::current().record("outcome", "superseded");
                    return Ok(true);
                }
            }
            // Release the read snapshot before the final brief authorization and
            // metadata write. This never holds privacy coordination during a scan.
            drop(snapshot);
            self.companies_repository
                .finish_email_preview(&job, &view)
                .await?;
            tracing::Span::current().record("outcome", format!("{:?}", view.status));
            Ok(true)
        }
        .instrument(span.clone())
        .await;
        if let Err(error) = &result {
            span.record("outcome", "error");
            span.in_scope(|| tracing::error!(error=?error, "CRM email preview failed"));
        }
        result
    }
}
