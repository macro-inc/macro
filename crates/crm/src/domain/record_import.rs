//! Records another CRM's import writes into the viewer's team CRM: companies
//! by domain, contacts by address, and Sales pipelines of deals. Every write
//! goes through [`CrmService`] and [`PipelineWorkflowService`] with the
//! viewer's own receipts, so an import keeps the access, validation and
//! field rules of the single-record tools.

use std::collections::HashMap;
use std::sync::Arc;

use databases::domain::models::Viewer;
use entity_access::domain::{
    models::{
        AccessError, EditAccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType,
        MemberTeamRole, ViewAccessLevel,
    },
    ports::EntityAccessService,
};
use uuid::Uuid;

use super::{
    auth::{CrmCompanyReceipt, CrmContactReceipt, CrmTeamReceipt},
    crm_csv::imported_domain,
    crm_transfer::TransferError,
    generic_email_domains::is_generic_email_domain,
    model::CrmError,
    pipeline_commercial::CURRENCIES,
    pipeline_workflows::{
        EntryAddition, FieldInput, FieldValue, NewField, NewFieldKind, NewPipeline,
        PipelineWorkflowService, RecordTarget,
    },
    pipelines::{PipelineRecordType, PipelineSharing},
    service::CrmService,
};

#[cfg(test)]
mod test;

/// The deal's name on its entry.
pub const DEAL_FIELD: &str = "Deal";
/// The deal's close date.
pub const CLOSE_DATE_FIELD: &str = "Close date";
/// The deal's page in the source CRM; unique per deal, so it identifies the entry.
pub const SOURCE_LINK_FIELD: &str = "Source link";
/// A tracked pipeline's standard owner field.
const OWNER_FIELD: &str = "Owner";
/// A tracked pipeline's standard amount field.
const REVENUE_FIELD: &str = "Revenue";
/// Its paired currency.
const REVENUE_CURRENCY_FIELD: &str = "Revenue currency";
/// The protected outcome field.
const OUTCOME_FIELD: &str = "Outcome";
/// The stage field.
const STAGE_FIELD: &str = "Stage";

/// The domain CRM keys an imported company by: a bare domain, URL or address
/// reduced to its host, never a personal email provider.
pub fn company_domain(raw: &str) -> Option<String> {
    imported_domain(raw).filter(|domain| !is_generic_email_domain(domain))
}

/// Whether a pipeline amount may carry `code`.
pub fn supports_currency(code: &str) -> bool {
    CURRENCIES.contains(&code)
}

/// Where an imported deal stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportedOutcome {
    /// Still open.
    Open,
    /// Closed won.
    Won,
    /// Closed lost.
    Lost,
}

impl ImportedOutcome {
    fn label(self) -> &'static str {
        match self {
            Self::Open => "Open",
            Self::Won => "Won",
            Self::Lost => "Lost",
        }
    }
}

/// A deal to add as an entry tracking `company`.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportedDeal {
    /// The company.
    pub company: Uuid,
    /// Its name.
    pub name: String,
    /// One of the pipeline's stage labels.
    pub stage: Option<String>,
    /// Outcome.
    pub outcome: ImportedOutcome,
    /// Amount with its supported currency.
    pub amount: Option<(f64, String)>,
    /// `YYYY-MM-DD`.
    pub close_date: Option<String>,
    /// The owner, a team member's email.
    pub owner: Option<String>,
    /// Its page in the source CRM.
    pub link: String,
}

/// The entries of `pipeline` among `entries`, by each source link they carry.
pub fn entries_by_link<'a>(
    entries: impl IntoIterator<Item = (Uuid, Uuid, &'a [(String, FieldValue)])>,
    pipeline: Uuid,
) -> HashMap<String, Uuid> {
    entries
        .into_iter()
        .filter(|(holder, _, _)| *holder == pipeline)
        .flat_map(|(_, entry, fields)| {
            fields
                .iter()
                .filter(|(name, _)| name == SOURCE_LINK_FIELD)
                .flat_map(move |(_, value)| match value {
                    FieldValue::Links(links) => links.clone(),
                    _ => Vec::new(),
                })
                .map(move |link| (link, entry))
        })
        .collect()
}

/// Imported records through the CRM services, as the viewer.
pub struct CrmRecordImports<Crm, Access, Workflows> {
    crm: Arc<Crm>,
    access: Arc<Access>,
    workflows: Arc<Workflows>,
}

impl<Crm, Access, Workflows> CrmRecordImports<Crm, Access, Workflows> {
    /// Imports through these services.
    pub fn new(crm: Arc<Crm>, access: Arc<Access>, workflows: Arc<Workflows>) -> Self {
        Self {
            crm,
            access,
            workflows,
        }
    }
}

impl<Crm, Access, Workflows> CrmRecordImports<Crm, Access, Workflows>
where
    Crm: CrmService,
    Access: EntityAccessService,
    Workflows: PipelineWorkflowService,
{
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

    /// The viewer's team, when they may use its CRM.
    #[tracing::instrument(skip_all, err)]
    pub async fn crm_team(&self, viewer: &Viewer) -> Result<Option<Uuid>, TransferError> {
        Ok(self
            .crm
            .current_member_access(viewer.user_id.as_ref())
            .await?
            .and_then(|(team, access)| access.then_some(team)))
    }

    /// The team's company for `domain`.
    #[tracing::instrument(skip_all, err)]
    pub async fn company_by_domain(
        &self,
        viewer: &Viewer,
        domain: &str,
    ) -> Result<Option<Uuid>, TransferError> {
        let team = self.team(viewer).await?;
        Ok(self
            .crm
            .get_company_by_domain(&team, domain)
            .await?
            .map(|company| company.company.id))
    }

    /// Create a company. A company made meanwhile for the same domain is
    /// returned instead; one the viewer cannot see is refused.
    #[tracing::instrument(skip_all, err)]
    pub async fn create_company(
        &self,
        viewer: &Viewer,
        name: &str,
        domain: Option<&str>,
    ) -> Result<Uuid, TransferError> {
        let team = self.team(viewer).await?;
        match self.crm.create_company(&team, name, domain).await {
            Ok(company) => Ok(company.company.id),
            Err(CrmError::CompanyAlreadyExistsForTeam) => {
                let existing = match domain {
                    Some(domain) => self.crm.get_company_by_domain(&team, domain).await?,
                    None => None,
                };
                existing.map(|company| company.company.id).ok_or_else(|| {
                    TransferError::Invalid(
                        "A company the user cannot see already has this domain.".into(),
                    )
                })
            }
            Err(error) => Err(error.into()),
        }
    }

    /// The team's contact holding `email` as any of its addresses.
    #[tracing::instrument(skip_all, err)]
    pub async fn contact_by_email(
        &self,
        viewer: &Viewer,
        email: &str,
    ) -> Result<Option<Uuid>, TransferError> {
        let team = self.team(viewer).await?;
        Ok(self
            .crm
            .get_contact_by_email(&team, email)
            .await?
            .map(|contact| contact.id))
    }

    async fn permission(
        &self,
        viewer: &Viewer,
        id: Uuid,
        entity_type: EntityType,
    ) -> Result<
        Option<(
            EntityAccessReceipt<ViewAccessLevel>,
            Uuid,
            entity_access::domain::models::TeamRole,
        )>,
        TransferError,
    > {
        let (permission, team_id, team_role) = match self
            .access
            .get_crm_entity_permission_with_team(
                Some(&viewer.user_id),
                &id.to_string(),
                entity_type,
            )
            .await
        {
            Ok(found) => found,
            Err(
                AccessError::NotFound(_)
                | AccessError::Unauthorized
                | AccessError::UnauthorizedWithMessage(_),
            ) => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        if !permission.satisfies::<ViewAccessLevel>() {
            return Ok(None);
        }
        let receipt = EntityAccessReceipt::try_new_authenticated_user(
            viewer.user_id.clone(),
            Entity {
                entity_id: id.to_string(),
                entity_type,
            },
            permission,
        )?;
        Ok(Some((receipt, team_id, team_role)))
    }

    /// Create a contact named `name` with `emails`, primary first, under
    /// `company` or, without one, filed by its address as CRM files new
    /// contacts. Further addresses another contact already holds are left off.
    #[tracing::instrument(skip_all, fields(emails = emails.len()), err)]
    pub async fn create_contact(
        &self,
        viewer: &Viewer,
        name: &str,
        emails: &[String],
        company: Option<Uuid>,
    ) -> Result<Uuid, TransferError> {
        let primary = emails.first().map(String::as_str);
        // A company the viewer cannot see is refused, never dropped: filing the
        // contact elsewhere would lose the association silently.
        let company = match company {
            Some(company) => Some(
                self.permission(viewer, company, EntityType::CrmCompany)
                    .await?
                    .ok_or_else(|| {
                        TransferError::Invalid("Its company is not visible to the user.".into())
                    })?,
            ),
            None => None,
        };
        let contact = match company {
            Some((receipt, team_id, team_role)) => {
                let receipt = CrmCompanyReceipt::new(receipt, team_id, team_role);
                self.crm.create_contact(&receipt, name, primary).await?
            }
            None => {
                let team = self.team(viewer).await?;
                self.crm.create_team_contact(&team, name, primary).await?
            }
        };
        if emails.len() > 1 {
            let (receipt, team_id, team_role) = self
                .permission(viewer, contact.id, EntityType::CrmContact)
                .await?
                .ok_or_else(|| {
                    TransferError::Invalid("The new contact is not visible to the user.".into())
                })?;
            let receipt: EntityAccessReceipt<EditAccessLevel> =
                receipt.try_into_requirement().map_err(|_| {
                    TransferError::Invalid("The user cannot edit the new contact.".into())
                })?;
            let receipt = CrmContactReceipt::new(receipt, team_id, team_role);
            for email in &emails[1..] {
                match self.crm.add_contact_email(&receipt, email).await {
                    Ok(_) => {}
                    Err(
                        CrmError::ContactAlreadyExistsForTeam
                        | CrmError::ContactAlreadyExistsForCompany
                        | CrmError::InvalidRequest(_),
                    ) => {}
                    Err(error) => return Err(error.into()),
                }
            }
        }
        Ok(contact.id)
    }

    /// Create a team-editable pipeline tracking companies, with `stages` in
    /// order and the fields imported deals fill.
    #[tracing::instrument(skip_all, fields(stages = stages.len()), err)]
    pub async fn create_deal_pipeline(
        &self,
        viewer: &Viewer,
        name: &str,
        stages: &[String],
    ) -> Result<Uuid, TransferError> {
        let field = |name: &str, kind| NewField {
            name: name.into(),
            kind,
            options: Vec::new(),
        };
        let created = self
            .workflows
            .create(
                viewer,
                NewPipeline {
                    name: name.into(),
                    record_type: Some(PipelineRecordType::Company),
                    sharing: PipelineSharing::Team,
                    stages: stages.to_vec(),
                    fields: vec![
                        field(DEAL_FIELD, NewFieldKind::Text),
                        field(CLOSE_DATE_FIELD, NewFieldKind::Date),
                        field(SOURCE_LINK_FIELD, NewFieldKind::Link),
                    ],
                },
            )
            .await?;
        Ok(created.pipeline.pipeline.id)
    }

    /// The entries of `pipeline` tracking `company`, by source link. Read
    /// from the company's own entries, so its cost follows the company, never
    /// the pipeline's size.
    #[tracing::instrument(skip_all, fields(%pipeline, entries), err)]
    pub async fn deal_entries(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
        company: Uuid,
    ) -> Result<HashMap<String, Uuid>, TransferError> {
        let entries = self.workflows.record_entries(viewer, &[company]).await?;
        let found = entries_by_link(
            entries.iter().flat_map(|group| {
                group.entries.iter().map(|entry| {
                    (
                        group.pipeline.pipeline.id,
                        entry.entry_id.into_uuid(),
                        entry.fields.as_slice(),
                    )
                })
            }),
            pipeline,
        );
        tracing::Span::current().record("entries", found.len());
        Ok(found)
    }

    /// Add one deal as an entry of `pipeline`.
    #[tracing::instrument(skip_all, fields(%pipeline), err)]
    pub async fn add_deal_entry(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
        deal: &ImportedDeal,
    ) -> Result<Uuid, TransferError> {
        let one = |value: &str| FieldInput::One(value.to_owned());
        let mut set = vec![
            (DEAL_FIELD.to_owned(), one(&deal.name)),
            (OUTCOME_FIELD.to_owned(), one(deal.outcome.label())),
            (SOURCE_LINK_FIELD.to_owned(), one(&deal.link)),
        ];
        if let Some(stage) = &deal.stage {
            set.push((STAGE_FIELD.to_owned(), one(stage)));
        }
        if let Some((amount, currency)) = &deal.amount {
            set.push((REVENUE_FIELD.to_owned(), one(&amount.to_string())));
            set.push((REVENUE_CURRENCY_FIELD.to_owned(), one(currency)));
        }
        if let Some(date) = &deal.close_date {
            set.push((CLOSE_DATE_FIELD.to_owned(), one(date)));
        }
        if let Some(owner) = &deal.owner {
            set.push((OWNER_FIELD.to_owned(), one(owner)));
        }
        let added = self
            .workflows
            .add(
                viewer,
                pipeline,
                vec![EntryAddition {
                    record: Some(RecordTarget::Id(deal.company)),
                    set,
                }],
                true,
            )
            .await?;
        added
            .added
            .first()
            .map(|entry| entry.entry_id.into_uuid())
            .ok_or_else(|| TransferError::Invalid("The pipeline added no entry.".into()))
    }
}
