use super::{CrmServiceImpl, NoOpCrmService, normalize_company_domain};
use crate::domain::{
    auth::CrmTeamReceipt,
    companies_repo::CompaniesRepository,
    company_metadata_resolver::CompanyMetadataResolver,
    email_privacy::{
        EmailBlockScope, EmailContributionMailbox, EmailPrivacyChange, EmailPrivacyService,
        EmailPrivacySettings,
    },
    model::CrmError,
};
use entity_access::domain::models::MemberTeamRole;

impl<CR: CompaniesRepository, R: CompanyMetadataResolver> EmailPrivacyService
    for CrmServiceImpl<CR, R>
{
    #[tracing::instrument(skip_all, fields(team_id = %team), err)]
    async fn contribution_mailbox(
        &self,
        team: uuid::Uuid,
        user: &str,
    ) -> Result<Option<EmailContributionMailbox>, CrmError> {
        self.companies_repository
            .contribution_mailbox(team, user)
            .await
    }

    #[tracing::instrument(skip_all, fields(team_id = %access.team_id()), err)]
    async fn email_privacy(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<EmailPrivacySettings, CrmError> {
        let user = access.receipt().get_authenticated_user().map_err(|_| {
            CrmError::InvalidRequest("email consent requires an authenticated user".into())
        })?;
        let mut settings = self
            .companies_repository
            .email_privacy(access.team_id(), user.as_ref())
            .await?;
        settings.can_remove_team_domains = access.has_admin_role();
        Ok(settings)
    }

    #[tracing::instrument(skip_all, fields(team_id = %access.team_id()), err)]
    async fn change_email_privacy(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        mut change: EmailPrivacyChange,
    ) -> Result<EmailPrivacySettings, CrmError> {
        let user = access.receipt().get_authenticated_user().map_err(|_| {
            CrmError::InvalidRequest("email consent requires an authenticated user".into())
        })?;
        match &mut change {
            EmailPrivacyChange::RemoveDomain {
                scope: EmailBlockScope::Team,
                ..
            } if !access.has_admin_role() => {
                return Err(CrmError::SettingsAdminRequired);
            }
            EmailPrivacyChange::AddDomain { domain, .. }
            | EmailPrivacyChange::RemoveDomain { domain, .. } => {
                *domain = normalize_company_domain(domain)?;
                if !domain.split('.').all(|label| {
                    !label.is_empty()
                        && label.len() <= 63
                        && !label.starts_with('-')
                        && !label.ends_with('-')
                        && label
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                }) {
                    return Err(CrmError::InvalidRequest(
                        "enter a valid company domain".into(),
                    ));
                }
            }
            EmailPrivacyChange::SetConsent { .. } => {}
        }
        self.companies_repository
            .change_email_privacy(access.team_id(), user.as_ref(), change)
            .await?;
        self.email_privacy(access).await
    }
}

impl EmailPrivacyService for NoOpCrmService {
    async fn contribution_mailbox(
        &self,
        _: uuid::Uuid,
        _: &str,
    ) -> Result<Option<EmailContributionMailbox>, CrmError> {
        Ok(None)
    }

    async fn email_privacy(
        &self,
        _: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<EmailPrivacySettings, CrmError> {
        unimplemented!("NoOpCrmService.email_privacy")
    }
    async fn change_email_privacy(
        &self,
        _: &CrmTeamReceipt<MemberTeamRole>,
        _: EmailPrivacyChange,
    ) -> Result<EmailPrivacySettings, CrmError> {
        unimplemented!("NoOpCrmService.change_email_privacy")
    }
}
