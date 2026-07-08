//! Toolset inbound adapter for the CRM domain.
//!
//! Exposes team-scoped CRM company tools (`ListCompanies`, `GetCompany`)
//! to AI agents. Property writes (stage moves, revenue, owner, custom
//! properties) go through the properties toolset's `SetEntityProperty`
//! with `entity_type = company`.

mod get_company;
mod list_companies;

use std::collections::HashMap;
use std::sync::Arc;

use ai_toolset::{AsyncToolCollection, RequestContext, ToolCallError};
use entity_access::domain::{
    models::{
        AccessError, Entity, EntityAccessReceipt, EntityPermission, EntityType, MemberTeamRole,
        TeamRole,
    },
    ports::EntityAccessService,
};
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use models_properties::{DataType, EntityType as PropertyEntityType};
use schemars::JsonSchema;
use serde::Serialize;
use system_properties::{StageOption, SystemPropertyKey};
use uuid::Uuid;

use crate::domain::{auth::CrmTeamReceipt, model::CrmError, service::CrmService};

pub use get_company::{GetCompany, GetCompanyResponse};
pub use list_companies::{ListCompanies, ListCompaniesResponse};

/// Service context for CRM AI tools.
pub struct CrmToolContext<CSvc, ESvc>
where
    CSvc: CrmService,
    ESvc: EntityAccessService,
{
    /// The CRM service used to read company records.
    pub service: Arc<CSvc>,
    /// The entity access service used to resolve the caller's team
    /// membership and CRM entity permissions.
    pub entity_access_service: Arc<ESvc>,
    /// Postgres pool used to read company property values (Stage /
    /// Owner / Revenue plus custom properties) via `properties_db_client`.
    pub pool: sqlx::PgPool,
}

impl<CSvc, ESvc> Clone for CrmToolContext<CSvc, ESvc>
where
    CSvc: CrmService,
    ESvc: EntityAccessService,
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            pool: self.pool.clone(),
        }
    }
}

impl<CSvc, ESvc> CrmToolContext<CSvc, ESvc>
where
    CSvc: CrmService,
    ESvc: EntityAccessService,
{
    /// Create a new CRM tool context.
    pub fn new(service: CSvc, entity_access_service: ESvc, pool: sqlx::PgPool) -> Self {
        Self {
            service: Arc::new(service),
            entity_access_service: Arc::new(entity_access_service),
            pool,
        }
    }
}

/// Create the CRM toolset.
pub fn crm_toolset<CSvc, ESvc>() -> AsyncToolCollection<CrmToolContext<CSvc, ESvc>>
where
    CSvc: CrmService,
    ESvc: EntityAccessService,
{
    AsyncToolCollection::new()
        .add_tool::<ListCompanies, CrmToolContext<CSvc, ESvc>>()
        .add_tool::<GetCompany, CrmToolContext<CSvc, ESvc>>()
}

/// A company's pipeline stage: the select option id currently set plus its
/// human-readable label.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolCompanyStage {
    /// The stage property option id (usable with SetEntityProperty).
    pub option_id: Uuid,
    /// The stage's display label (e.g. "Lead", "Customer").
    pub label: String,
}

/// The builtin CRM company property values extracted from a company's
/// entity properties.
#[derive(Debug, Default)]
pub(crate) struct CompanyCrmProps {
    pub(crate) stage: Option<ToolCompanyStage>,
    pub(crate) owner_user_id: Option<String>,
    pub(crate) revenue: Option<f64>,
}

/// The catalog of stage options available to a team: the system Stage
/// definition's options plus any team-scoped definition named "Stage"
/// (teams can customize their pipeline stages).
#[derive(Debug, Default)]
pub(crate) struct StageOptionCatalog {
    /// option id -> label
    labels: HashMap<Uuid, String>,
    /// Ids of team-scoped select definitions named "Stage". Teams with a
    /// customized pipeline store their stage values under one of these
    /// definitions instead of the system Stage definition, so property
    /// fetches filtered by definition id must include them.
    team_stage_definition_ids: Vec<Uuid>,
}

impl StageOptionCatalog {
    /// Resolve a stage option id to its label. Falls back to the builtin
    /// [`StageOption`] constants when the id isn't in the catalog.
    pub(crate) fn label_for(&self, option_id: Uuid) -> Option<String> {
        self.labels
            .get(&option_id)
            .cloned()
            .or_else(|| StageOption::from_uuid(option_id).map(|s| s.display_value().to_string()))
    }

    /// Resolve a user-supplied `stage` filter (an option id or a label,
    /// matched case-insensitively) to the set of matching option ids.
    pub(crate) fn matching_option_ids(&self, stage: &str) -> Vec<Uuid> {
        let trimmed = stage.trim();
        if let Ok(id) = Uuid::parse_str(trimmed) {
            return vec![id];
        }
        self.labels
            .iter()
            .filter(|(_, label)| label.eq_ignore_ascii_case(trimmed))
            .map(|(id, _)| *id)
            .collect()
    }

    /// Ids of the team-scoped "Stage" definitions (empty when the team
    /// only uses the system Stage definition).
    pub(crate) fn team_stage_definition_ids(&self) -> &[Uuid] {
        &self.team_stage_definition_ids
    }

    /// The distinct stage labels known to this team, for actionable error
    /// messages.
    pub(crate) fn known_labels(&self) -> Vec<String> {
        let mut labels: Vec<String> = self.labels.values().cloned().collect();
        labels.sort();
        labels.dedup();
        labels
    }
}

/// Load the stage option catalog for `team_id`: options of the system
/// Stage definition (id `00000001-0000-0000-0000-000000000010`) plus any
/// team-scoped select definition named "Stage".
pub(crate) async fn load_stage_option_catalog(
    pool: &sqlx::PgPool,
    team_id: Uuid,
) -> Result<StageOptionCatalog, ToolCallError> {
    let defs = properties_db_client::property_definitions::get::get_properties_with_options(
        pool,
        Some(team_id),
        None,
        true,
    )
    .await
    .map_err(|e| ToolCallError {
        description: "failed to load the team's stage options".to_string(),
        internal_error: e.into(),
    })?;

    let mut labels = HashMap::new();
    let mut team_stage_definition_ids = Vec::new();
    for def in defs {
        let is_stage_definition = def.definition.id == SystemPropertyKey::STAGE_UUID
            || (def.definition.display_name.eq_ignore_ascii_case("stage")
                && matches!(
                    def.definition.data_type,
                    DataType::SelectString | DataType::SelectNumber
                ));
        if !is_stage_definition {
            continue;
        }
        if def.definition.id != SystemPropertyKey::STAGE_UUID {
            team_stage_definition_ids.push(def.definition.id);
        }
        for option in def.property_options {
            let label = match option.value {
                PropertyOptionValue::String(s) => s,
                PropertyOptionValue::Number(n) => n.to_string(),
            };
            labels.insert(option.id, label);
        }
    }

    // Make sure the builtin defaults are always resolvable, even if the
    // seed rows are missing from this environment.
    for stage in [
        StageOption::Lead,
        StageOption::Qualified,
        StageOption::Demo,
        StageOption::Trial,
        StageOption::Negotiation,
        StageOption::Customer,
        StageOption::Churned,
    ] {
        labels
            .entry(stage.uuid())
            .or_insert_with(|| stage.display_value().to_string());
    }

    Ok(StageOptionCatalog {
        labels,
        team_stage_definition_ids,
    })
}

/// Extract the builtin CRM props (Stage / Owner / Revenue) from a
/// company's entity properties. The stage may live on the system Stage
/// definition or on a team-scoped select definition named "Stage";
/// teams with customized pipelines use the latter, so its value wins
/// over one set under the system definition.
pub(crate) fn extract_company_crm_props(
    props: &[EntityPropertyWithDefinition],
    stages: &StageOptionCatalog,
) -> CompanyCrmProps {
    let mut out = CompanyCrmProps::default();
    let mut system_stage: Option<ToolCompanyStage> = None;
    let mut team_stage: Option<ToolCompanyStage> = None;
    for prop in props {
        let definition_id = prop.property.property_definition_id;
        if definition_id == SystemPropertyKey::COMPANY_OWNER_UUID {
            if let Some(PropertyValue::EntityRef(refs)) = &prop.value {
                out.owner_user_id = refs.first().map(|r| r.entity_id.clone());
            }
            continue;
        }
        if definition_id == SystemPropertyKey::REVENUE_UUID {
            if let Some(PropertyValue::Num(n)) = prop.value {
                out.revenue = Some(n);
            }
            continue;
        }
        let is_system_stage = definition_id == SystemPropertyKey::STAGE_UUID;
        let is_team_stage = !is_system_stage
            && (stages.team_stage_definition_ids.contains(&definition_id)
                || prop.definition.display_name.eq_ignore_ascii_case("stage"));
        let slot = if is_system_stage {
            &mut system_stage
        } else if is_team_stage {
            &mut team_stage
        } else {
            continue;
        };
        if slot.is_none()
            && let Some(PropertyValue::SelectOption(option_ids)) = &prop.value
            && let Some(option_id) = option_ids.first().copied()
        {
            // Prefer the options attached to the property itself, then
            // the team catalog / builtin defaults.
            let label = prop
                .options
                .as_ref()
                .and_then(|options| {
                    options
                        .iter()
                        .find(|o| o.id == option_id)
                        .map(|o| match &o.value {
                            PropertyOptionValue::String(s) => s.clone(),
                            PropertyOptionValue::Number(n) => n.to_string(),
                        })
                })
                .or_else(|| stages.label_for(option_id))
                .unwrap_or_else(|| option_id.to_string());
            *slot = Some(ToolCompanyStage { option_id, label });
        }
    }
    out.stage = team_stage.or(system_stage);
    out
}

/// Entity references for a batch of company ids, in `entity_properties`
/// terms (`entity_type = company`).
pub(crate) fn company_entity_refs(
    company_ids: impl IntoIterator<Item = Uuid>,
) -> Vec<models_properties::shared::EntityReference> {
    company_ids
        .into_iter()
        .map(|id| models_properties::shared::EntityReference {
            entity_type: PropertyEntityType::Company,
            entity_id: id.to_string(),
            specific_message_id: None,
        })
        .collect()
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

/// Map an [`AccessError`] into an actionable tool error.
pub(crate) fn team_access_error(err: AccessError) -> ToolCallError {
    let description = match err {
        AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
            "user is not a member of a team"
        }
        AccessError::NotFound(_) => "team not found",
        AccessError::BadRequest(_) => "invalid team membership",
        AccessError::DatabaseError(_) | AccessError::Internal => "failed to verify team membership",
    };

    ToolCallError {
        description: description.to_string(),
        internal_error: err.into(),
    }
}

/// Map a [`CrmError`] into an actionable tool error.
pub(crate) fn crm_error(err: CrmError) -> ToolCallError {
    let description = match &err {
        CrmError::CompanyNotFoundForTeam => {
            "CRM company not found for the caller's team".to_string()
        }
        CrmError::ContactNotFoundForTeam => {
            "CRM contact not found for the caller's team".to_string()
        }
        CrmError::InvalidRequest(msg) => msg.clone(),
        _ => "CRM request failed".to_string(),
    };

    ToolCallError {
        description,
        internal_error: err.into(),
    }
}
