//! Toolset inbound adapter for the CRM domain.
//!
//! Exposes team-scoped CRM company tools (`ListCompanies`, `GetCompany`,
//! `CreateCompany`, `CreateContact`) to AI agents. The company's own
//! properties (its Stage, Owner, Revenue and custom properties) are written
//! through the properties toolset's `SetEntityProperty` with
//! `entity_type = company`. Pipelines, whose entries carry their own stage
//! and fields, have their own tools in [`pipelines`].

mod create_company;
mod create_contact;
mod get_company;
mod list_companies;
pub mod pipelines;
pub mod transfer;

#[cfg(test)]
mod test;

use std::sync::Arc;

use ai_toolset::{AsyncToolCollection, RequestContext, ToolCallError};
use entity_access::domain::{
    models::{
        AccessError, Entity, EntityAccessReceipt, EntityPermission, EntityType, MemberTeamRole,
        TeamRole, ViewAccessLevel,
    },
    ports::EntityAccessService,
};
use properties::PropertiesService;
use schemars::JsonSchema;
use serde::Serialize;
use uuid::Uuid;

pub(crate) use crate::domain::company_listing::{StageOptionCatalog, extract_company_crm_props};
use crate::domain::{
    auth::{CrmCompanyReceipt, CrmTeamReceipt},
    company_listing::{self, CompanyStage},
    model::CrmError,
    service::CrmService,
};

pub use create_company::{CreateCompany, CreateCompanyResponse};
pub use create_contact::{CreateContact, CreateContactResponse};
pub use get_company::{GetCompany, GetCompanyResponse};
pub use list_companies::{ListCompanies, ListCompaniesResponse};

/// Service context for CRM AI tools.
pub struct CrmToolContext<CSvc, ESvc, PSvc>
where
    CSvc: CrmService,
    ESvc: EntityAccessService,
    PSvc: PropertiesService,
{
    /// The CRM service used to read company records.
    pub service: Arc<CSvc>,
    /// The entity access service used to resolve the caller's team
    /// membership and CRM entity permissions.
    pub entity_access_service: Arc<ESvc>,
    /// The properties domain service used to read company property values
    /// (Stage / Owner / Revenue plus custom properties) and the team's
    /// property definitions.
    pub properties: Arc<PSvc>,
}

impl<CSvc, ESvc, PSvc> Clone for CrmToolContext<CSvc, ESvc, PSvc>
where
    CSvc: CrmService,
    ESvc: EntityAccessService,
    PSvc: PropertiesService,
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            properties: self.properties.clone(),
        }
    }
}

impl<CSvc, ESvc, PSvc> CrmToolContext<CSvc, ESvc, PSvc>
where
    CSvc: CrmService,
    ESvc: EntityAccessService,
    PSvc: PropertiesService,
{
    /// Create a new CRM tool context.
    pub fn new(service: CSvc, entity_access_service: ESvc, properties: Arc<PSvc>) -> Self {
        Self {
            service: Arc::new(service),
            entity_access_service: Arc::new(entity_access_service),
            properties,
        }
    }
}

/// Create the CRM toolset.
pub fn crm_toolset<CSvc, ESvc, PSvc>() -> AsyncToolCollection<CrmToolContext<CSvc, ESvc, PSvc>>
where
    CSvc: CrmService,
    ESvc: EntityAccessService,
    PSvc: PropertiesService,
{
    AsyncToolCollection::new()
        .add_tool::<ListCompanies, CrmToolContext<CSvc, ESvc, PSvc>>()
        .add_tool::<GetCompany, CrmToolContext<CSvc, ESvc, PSvc>>()
        .add_tool::<CreateCompany, CrmToolContext<CSvc, ESvc, PSvc>>()
        .add_tool::<CreateContact, CrmToolContext<CSvc, ESvc, PSvc>>()
}

/// A company's own Stage property: the select option id currently set plus its
/// human-readable label.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolCompanyStage {
    /// The stage property option id (usable with SetEntityProperty).
    pub option_id: Uuid,
    /// The stage's display label (e.g. "Lead", "Customer").
    pub label: String,
}

impl From<CompanyStage> for ToolCompanyStage {
    fn from(stage: CompanyStage) -> Self {
        Self {
            option_id: stage.option_id,
            label: stage.label,
        }
    }
}

/// The team's stage options, as a tool error when they cannot be read.
pub(crate) async fn load_stage_option_catalog<PSvc>(
    properties: &PSvc,
    team: &properties::TeamReceipt,
) -> Result<StageOptionCatalog, ToolCallError>
where
    PSvc: PropertiesService,
{
    company_listing::load_stage_option_catalog(properties, team)
        .await
        .map_err(|e| ToolCallError {
            description: "failed to load the team's stage options".to_string(),
            internal_error: e.into(),
        })
}

/// Resolve the caller's team and mint a member-level team receipt for
/// CRM listing calls. Errors with an actionable message when the caller
/// has no team.
pub(crate) async fn caller_team_receipt<ESvc>(
    entity_access_service: &ESvc,
    request_context: &RequestContext,
) -> Result<(CrmTeamReceipt<MemberTeamRole>, TeamRole), ToolCallError>
where
    ESvc: EntityAccessService,
{
    let team_info = entity_access_service
        .get_user_team(&request_context.user_id)
        .await
        .map_err(team_access_error)?;

    let Some(team_info) = team_info else {
        return Err(ToolCallError {
            description: "user is not in a team, so there is no team CRM to query".to_string(),
            internal_error: anyhow::anyhow!("user is not in a team"),
        });
    };

    let receipt = EntityAccessReceipt::try_new_authenticated_user(
        request_context.user_id.clone(),
        Entity {
            entity_id: team_info.team_id.to_string(),
            entity_type: EntityType::Team,
        },
        EntityPermission::TeamRole {
            role: team_info.role,
        },
    )
    .map_err(team_access_error)?;

    let receipt = CrmTeamReceipt::from_team_receipt(receipt).map_err(crm_error)?;

    Ok((receipt, team_info.role))
}

/// Resolve the caller's permission on a CRM company (derived from their
/// role on the owning team) and mint a view receipt for it, returning the
/// owning team id. Access failures collapse to "not found" so company ids
/// can't be probed across teams.
pub(crate) async fn company_view_receipt<ESvc>(
    entity_access_service: &ESvc,
    request_context: &RequestContext,
    company_id: Uuid,
) -> Result<(CrmCompanyReceipt<ViewAccessLevel>, Uuid), ToolCallError>
where
    ESvc: EntityAccessService,
{
    let company_id = company_id.to_string();
    let (permission, team_id, team_role) = match entity_access_service
        .get_crm_entity_permission_with_team(
            Some(&request_context.user_id),
            &company_id,
            EntityType::CrmCompany,
        )
        .await
    {
        Ok(triple) => triple,
        Err(
            AccessError::Unauthorized
            | AccessError::UnauthorizedWithMessage(_)
            | AccessError::NotFound(_),
        ) => return Err(company_not_found()),
        Err(e) => {
            return Err(ToolCallError {
                description: "failed to verify access to the CRM company".to_string(),
                internal_error: e.into(),
            });
        }
    };

    if !permission.satisfies::<ViewAccessLevel>() {
        return Err(company_not_found());
    }

    let receipt = EntityAccessReceipt::try_new_authenticated_user(
        request_context.user_id.clone(),
        Entity {
            entity_id: company_id,
            entity_type: EntityType::CrmCompany,
        },
        permission,
    )
    .map_err(|e| ToolCallError {
        description: "failed to verify access to the CRM company".to_string(),
        internal_error: e.into(),
    })?;
    Ok((CrmCompanyReceipt::new(receipt, team_id, team_role), team_id))
}

fn company_not_found() -> ToolCallError {
    ToolCallError {
        description: "CRM company not found or not accessible to the caller's team".to_string(),
        internal_error: anyhow::anyhow!("crm company not found or not accessible"),
    }
}

/// Map an [`AccessError`] into an actionable tool error.
pub(crate) fn team_access_error(err: AccessError) -> ToolCallError {
    let description = match err {
        AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
            "user is not a member of a team"
        }
        AccessError::NotFound(_) => "team not found",
        AccessError::BadRequest(_) => "invalid team membership",
        AccessError::Unavailable(_) | AccessError::Internal(_) => {
            "failed to verify team membership"
        }
    };

    ToolCallError {
        description: description.to_string(),
        internal_error: err.into(),
    }
}

/// Map a [`CrmError`] into an actionable tool error.
pub(crate) fn crm_error(err: CrmError) -> ToolCallError {
    ToolCallError {
        description: crm_error_description(&err),
        internal_error: err.into(),
    }
}

/// What went wrong, in words the model can act on.
pub(crate) fn crm_error_description(err: &CrmError) -> String {
    match err {
        CrmError::CompanyNotFoundForTeam => {
            "CRM company not found for the caller's team".to_string()
        }
        CrmError::ContactNotFoundForTeam => {
            "CRM contact not found for the caller's team".to_string()
        }
        CrmError::InvalidRequest(msg) => msg.clone(),
        CrmError::CrmDisabledForTeam => "CRM is turned off for the caller's team".to_string(),
        CrmError::CompanyAlreadyExistsForTeam => {
            "the team already tracks a company with that domain".to_string()
        }
        CrmError::ContactAlreadyExistsForCompany => {
            "the company already has a contact with that email".to_string()
        }
        CrmError::StageEditRoleRequired(role) => format!(
            "editing deal stages requires the {} team role",
            role.as_db_str()
        ),
        _ => "CRM request failed".to_string(),
    }
}
