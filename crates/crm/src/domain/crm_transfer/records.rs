//! [`TransferRecords`] over the CRM service: the viewer's team CRM, with the
//! same receipts and refusals as the single-record tools.

use std::collections::HashMap;
use std::sync::Arc;

use databases::domain::models::Viewer;
use entity_access::domain::{
    models::{AccessError, Entity, EntityAccessReceipt, EntityPermission, EntityType},
    ports::EntityAccessService,
};
use uuid::Uuid;

use super::super::{
    auth::{CrmCompanyReceipt, CrmTeamReceipt},
    companies_repo::{CrmCompanyListSort, CrmCompanySoupCursor},
    model::CrmError,
    service::CrmService,
};
use super::models::{Created, TransferError, TransferRecords};
use entity_access::domain::models::{MemberTeamRole, ViewAccessLevel};

/// Companies read per page while matching domains.
const PAGE: i64 = 500;

/// [`TransferRecords`] through [`CrmService`].
pub struct CrmTransferRecords<Crm, Access> {
    crm: Arc<Crm>,
    access: Arc<Access>,
}

impl<Crm, Access> CrmTransferRecords<Crm, Access> {
    /// Records through `crm`, authorized by `access`.
    pub fn new(crm: Arc<Crm>, access: Arc<Access>) -> Self {
        Self { crm, access }
    }
}

impl<Crm: CrmService, Access: EntityAccessService> CrmTransferRecords<Crm, Access> {
    async fn team(&self, viewer: &Viewer) -> Result<CrmTeamReceipt<MemberTeamRole>, TransferError> {
        let team = self
            .access
            .get_user_team(&viewer.user_id)
            .await?
            .ok_or_else(|| {
                TransferError::Invalid("The user is not in a team, so they have no CRM.".into())
            })?;
        let receipt = EntityAccessReceipt::try_new_authenticated_user(
            viewer.user_id.clone(),
            Entity {
                entity_id: team.team_id.to_string(),
                entity_type: EntityType::Team,
            },
            EntityPermission::TeamRole { role: team.role },
        )?;
        Ok(CrmTeamReceipt::from_team_receipt(receipt)?)
    }
}

/// A refusal the user can fix by changing the row, as opposed to a failure.
fn refusal(error: CrmError) -> Result<Created, TransferError> {
    match error {
        CrmError::CompanyAlreadyExistsForTeam | CrmError::ContactAlreadyExistsForCompany => {
            Ok(Created::Exists)
        }
        CrmError::InvalidRequest(reason) => Ok(Created::Refused(reason)),
        CrmError::ContactEmailDomainMismatch => Ok(Created::Refused(
            "the email's domain is not one of its company's domains".into(),
        )),
        CrmError::CompanyHidden => Ok(Created::Refused("its company is hidden".into())),
        other => Err(other.into()),
    }
}

impl<Crm: CrmService, Access: EntityAccessService> TransferRecords
    for CrmTransferRecords<Crm, Access>
{
    async fn company_domains(
        &self,
        viewer: &Viewer,
    ) -> Result<HashMap<String, Uuid>, TransferError> {
        let team = self.team(viewer).await?;
        let mut domains = HashMap::new();
        let mut cursor = None;
        loop {
            let page = self
                .crm
                .list_companies_for_soup(
                    &team,
                    viewer.user_id.as_ref(),
                    &[],
                    Some(false),
                    CrmCompanyListSort::UpdatedAt,
                    cursor,
                    PAGE,
                )
                .await?;
            for company in &page {
                for domain in &company.company.domains {
                    domains.insert(domain.domain.to_ascii_lowercase(), company.company.id);
                }
            }
            match page.last() {
                Some(last) if page.len() as i64 == PAGE => {
                    cursor = Some(CrmCompanySoupCursor {
                        last_sort_ts: last.company.updated_at,
                        last_id: last.company.id,
                    });
                }
                _ => return Ok(domains),
            }
        }
    }

    async fn create_company(
        &self,
        viewer: &Viewer,
        name: &str,
        domain: &str,
    ) -> Result<Created, TransferError> {
        let team = self.team(viewer).await?;
        match self.crm.create_company(&team, name, domain).await {
            Ok(company) => Ok(Created::New(company.company.id)),
            Err(error) => refusal(error),
        }
    }

    async fn contact(&self, viewer: &Viewer, email: &str) -> Result<Option<Uuid>, TransferError> {
        let team = self.team(viewer).await?;
        Ok(self
            .crm
            .get_contact_by_email(&team, email)
            .await?
            .map(|contact| contact.id))
    }

    async fn create_contact(
        &self,
        viewer: &Viewer,
        company: Uuid,
        name: &str,
        email: &str,
    ) -> Result<Created, TransferError> {
        let (permission, team_id, team_role) = match self
            .access
            .get_crm_entity_permission_with_team(
                Some(&viewer.user_id),
                &company.to_string(),
                EntityType::CrmCompany,
            )
            .await
        {
            Ok(found) => found,
            Err(
                AccessError::NotFound(_)
                | AccessError::Unauthorized
                | AccessError::UnauthorizedWithMessage(_),
            ) => {
                return Ok(Created::Refused(
                    "its company is not visible to the user".into(),
                ));
            }
            Err(error) => return Err(error.into()),
        };
        if !permission.satisfies::<ViewAccessLevel>() {
            return Ok(Created::Refused(
                "its company is not visible to the user".into(),
            ));
        }
        let receipt = EntityAccessReceipt::try_new_authenticated_user(
            viewer.user_id.clone(),
            Entity {
                entity_id: company.to_string(),
                entity_type: EntityType::CrmCompany,
            },
            permission,
        )?;
        let receipt = CrmCompanyReceipt::new(receipt, team_id, team_role);
        match self.crm.create_contact(&receipt, name, email).await {
            Ok(contact) => Ok(Created::New(contact.id)),
            Err(error) => refusal(error),
        }
    }
}
