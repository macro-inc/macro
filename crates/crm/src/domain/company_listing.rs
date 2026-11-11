//! The team's CRM companies, most recent interaction first, with each
//! company's own Stage, Owner and Revenue. Shared by the `ListCompanies` tool
//! and `GET /crm/companies/list`.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use entity_access::domain::models::{
    AdminTeamRole, EntityAccessReceipt, EntityType, MemberTeamRole, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::DataType;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use properties::{PropertiesErr, PropertiesService, PropertyTargetKey};
use serde::Serialize;
use system_properties::{StageOption, SystemPropertyKey};
use uuid::Uuid;

use crate::domain::{
    auth::CrmTeamReceipt,
    companies_repo::CrmCompanyListSort,
    model::{CrmCompanyForSoup, CrmError},
    service::CrmService,
    stages::CRM_TEAM_STAGE_DEFINITION_NAME,
};

/// Companies returned when a query names no limit.
pub const DEFAULT_LIMIT: u16 = 50;
/// The most companies one listing returns.
pub const MAX_LIMIT: u16 = 200;
/// Companies read before filtering in memory: the cap the app's CRM list
/// pages at.
const FETCH_LIMIT: i64 = 500;

/// A company's own Stage property: the option set and its label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompanyStage {
    /// The stage option id.
    pub option_id: Uuid,
    /// The stage's label, such as "Lead" or "Customer".
    pub label: String,
}

/// A company's own Stage, Owner and Revenue properties.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct CompanyCrmProps {
    /// Its Stage, when set.
    pub stage: Option<CompanyStage>,
    /// Macro user id of its owner, when set.
    pub owner_user_id: Option<String>,
    /// Its revenue in dollars, when set.
    pub revenue: Option<f64>,
}

/// The stage options a team can set: the system Stage definition's plus any
/// team-scoped select definition named "Stage", which teams that customized
/// their stages use instead.
#[derive(Debug, Default)]
pub struct StageOptionCatalog {
    /// Option id to label.
    labels: HashMap<Uuid, String>,
    /// The team's own "Stage" definitions, which property reads filtered by
    /// definition must include.
    team_stage_definition_ids: Vec<Uuid>,
}

impl StageOptionCatalog {
    /// An option's label, falling back to the builtin [`StageOption`]s.
    pub fn label_for(&self, option_id: Uuid) -> Option<String> {
        self.labels
            .get(&option_id)
            .cloned()
            .or_else(|| StageOption::from_uuid(option_id).map(|s| s.display_value().to_string()))
    }

    /// The options a stage filter names: an option id, or a label matched
    /// ignoring case.
    pub fn matching_option_ids(&self, stage: &str) -> Vec<Uuid> {
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

    /// The team's own "Stage" definitions; empty when it uses the system one.
    pub fn team_stage_definition_ids(&self) -> &[Uuid] {
        &self.team_stage_definition_ids
    }

    /// The team's distinct stage labels, sorted.
    pub fn known_labels(&self) -> Vec<String> {
        let mut labels: Vec<String> = self.labels.values().cloned().collect();
        labels.sort();
        labels.dedup();
        labels
    }
}

/// Load the stage options of the team `team` proves membership of.
pub async fn load_stage_option_catalog<Properties: PropertiesService>(
    properties: &Properties,
    team: &properties::TeamReceipt,
) -> Result<StageOptionCatalog, PropertiesErr> {
    let definitions = properties
        .list_property_definitions_with_options(Some(team), None, true, None)
        .await?;

    let mut labels = HashMap::new();
    let mut team_stage_definition_ids = Vec::new();
    for definition in definitions {
        let is_stage_definition = definition.definition.id == SystemPropertyKey::STAGE_UUID
            || (definition.definition.display_name == CRM_TEAM_STAGE_DEFINITION_NAME
                && matches!(
                    definition.definition.data_type,
                    DataType::SelectString | DataType::SelectNumber
                ));
        if !is_stage_definition {
            continue;
        }
        if definition.definition.id != SystemPropertyKey::STAGE_UUID {
            team_stage_definition_ids.push(definition.definition.id);
        }
        for option in definition.property_options {
            labels.insert(option.id, option_label(&option.value));
        }
    }

    // The builtin defaults stay resolvable even where their seed rows are
    // missing.
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

fn option_label(value: &PropertyOptionValue) -> String {
    match value {
        PropertyOptionValue::String(s) => s.clone(),
        PropertyOptionValue::Number(n) => n.to_string(),
    }
}

/// A company's Stage, Owner and Revenue from its entity properties. A team
/// "Stage" definition's value wins over the system one's: teams that
/// customized their stages store them there.
pub fn extract_company_crm_props(
    props: &[EntityPropertyWithDefinition],
    stages: &StageOptionCatalog,
) -> CompanyCrmProps {
    let mut out = CompanyCrmProps::default();
    let mut system_stage: Option<CompanyStage> = None;
    let mut team_stage: Option<CompanyStage> = None;
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
                || prop.definition.display_name == CRM_TEAM_STAGE_DEFINITION_NAME);
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
            // The property's own options first, then the team catalog and
            // the builtin defaults.
            let label = prop
                .options
                .as_ref()
                .and_then(|options| {
                    options
                        .iter()
                        .find(|o| o.id == option_id)
                        .map(|o| option_label(&o.value))
                })
                .or_else(|| stages.label_for(option_id))
                .unwrap_or_else(|| option_id.to_string());
            *slot = Some(CompanyStage { option_id, label });
        }
    }
    out.stage = team_stage.or(system_stage);
    out
}

/// Properties view receipts for companies whose access the CRM already
/// proved (the caller's team listing, or a company permission check).
/// Asserted rather than minted, so a batch costs no lookup per company.
pub fn company_view_receipts(
    user_id: &MacroUserIdStr<'static>,
    company_ids: impl IntoIterator<Item = Uuid>,
) -> Vec<properties::ViewReceipt> {
    company_ids
        .into_iter()
        .map(|id| {
            EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_authenticated_user(
                user_id.clone(),
                &id.to_string(),
                EntityType::CrmCompany,
            )
        })
        .collect()
}

/// Which of the team's companies to list.
#[derive(Debug, Clone, Default)]
pub struct CompanyListQuery {
    /// Text matched, ignoring case, against names and domains.
    pub search: Option<String>,
    /// The company's own Stage: a label, ignoring case, or an option id.
    pub stage: Option<String>,
    /// Macro user id of the company's owner, ignoring case.
    pub owner_user_id: Option<String>,
    /// Also list hidden companies; team admins and owners only.
    pub include_hidden: bool,
    /// At most this many, from 1 to [`MAX_LIMIT`]; [`DEFAULT_LIMIT`] when
    /// `None`.
    pub limit: Option<u16>,
}

/// One listed company.
#[derive(Debug, Clone, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListedCompany {
    /// The company id.
    pub id: Uuid,
    /// Its display name, when resolved.
    pub name: Option<String>,
    /// Its email domains, primary first.
    pub domains: Vec<String>,
    /// Whether it is hidden from the team's CRM listings.
    pub hidden: bool,
    /// The most recent known email interaction with it.
    pub last_interaction: DateTime<Utc>,
    /// Its own Stage, separate from any pipeline entry's.
    pub stage: Option<CompanyStage>,
    /// Macro user id of its owner.
    pub owner_user_id: Option<String>,
    /// Its revenue in dollars.
    pub revenue: Option<f64>,
}

/// A page of listed companies, most recent interaction first.
#[derive(Debug, Clone, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompanyListing {
    /// The companies, at most the query's limit.
    pub companies: Vec<ListedCompany>,
    /// How many companies matched before the limit.
    pub total_matching: usize,
}

/// Why a listing failed.
#[derive(Debug, thiserror::Error)]
pub enum CompanyListingError {
    /// Hidden companies were asked for by a member who is not an admin.
    #[error("include_hidden requires team admin or owner role")]
    HiddenRequiresAdmin,
    /// The stage filter names no stage the team has.
    #[error("unknown stage '{stage}'. Known stages for this team: {}", known.join(", "))]
    UnknownStage {
        /// The filter as given.
        stage: String,
        /// The team's stage labels.
        known: Vec<String>,
    },
    /// The CRM read failed.
    #[error(transparent)]
    Crm(#[from] CrmError),
    /// Stage options or company properties could not be read.
    #[error("failed to load company properties")]
    Properties(#[from] PropertiesErr),
}

/// List the companies of the team `team` proves membership of, most recent
/// interaction first, filtered by `query`.
#[tracing::instrument(
    skip_all,
    fields(
        team_id = %team.team_id(),
        include_hidden = query.include_hidden,
        total_matching = tracing::field::Empty,
    ),
    err
)]
pub async fn list_companies<Crm: CrmService, Properties: PropertiesService>(
    crm: &Crm,
    properties: &Properties,
    team: &CrmTeamReceipt<MemberTeamRole>,
    query: &CompanyListQuery,
) -> Result<CompanyListing, CompanyListingError> {
    if query.include_hidden
        && team
            .receipt()
            .clone()
            .try_into_requirement::<AdminTeamRole>()
            .is_err()
    {
        return Err(CompanyListingError::HiddenRequiresAdmin);
    }
    let user_id = team
        .receipt()
        .get_authenticated_user()
        .map_err(|error| CrmError::InvalidRequest(error.to_string()))?
        .clone();
    let limit = usize::from(query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT));

    let mut companies = read_companies(crm, team, &user_id, false).await?;
    if query.include_hidden {
        companies.extend(read_companies(crm, team, &user_id, true).await?);
        companies.sort_by(|a, b| {
            b.company
                .updated_at
                .cmp(&a.company.updated_at)
                .then_with(|| b.company.id.cmp(&a.company.id))
        });
    }

    // Text first, so properties are read only for candidates.
    if let Some(needle) = non_blank(query.search.as_deref()).map(str::to_lowercase) {
        companies.retain(|c| matches_search(c, &needle));
    }

    let stages = load_stage_option_catalog(properties, team.receipt()).await?;
    // An unknown stage fails with the team's stages rather than listing none.
    let stage_option_ids = match non_blank(query.stage.as_deref()) {
        Some(stage) => {
            let ids = stages.matching_option_ids(stage);
            if ids.is_empty() {
                return Err(CompanyListingError::UnknownStage {
                    stage: stage.to_owned(),
                    known: stages.known_labels(),
                });
            }
            Some(ids)
        }
        None => None,
    };

    // The team listing above proves access to these companies.
    let access = company_view_receipts(&user_id, companies.iter().map(|c| c.company.id));
    let mut definition_ids = vec![
        SystemPropertyKey::STAGE_UUID,
        SystemPropertyKey::COMPANY_OWNER_UUID,
        SystemPropertyKey::REVENUE_UUID,
    ];
    definition_ids.extend_from_slice(stages.team_stage_definition_ids());
    let properties_by_company = properties
        .get_bulk_entity_properties(&access, definition_ids)
        .await?;

    let owner = non_blank(query.owner_user_id.as_deref());
    let mut listed = Vec::new();
    let mut total_matching = 0usize;
    for company in companies {
        let key = PropertyTargetKey {
            entity_id: company.company.id.to_string(),
            entity_type: EntityType::CrmCompany,
        };
        let props = properties_by_company
            .get(&key)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let props = extract_company_crm_props(props, &stages);
        if let Some(ids) = &stage_option_ids
            && !props
                .stage
                .as_ref()
                .is_some_and(|stage| ids.contains(&stage.option_id))
        {
            continue;
        }
        if let Some(owner) = owner
            && !props
                .owner_user_id
                .as_deref()
                .is_some_and(|id| id.eq_ignore_ascii_case(owner))
        {
            continue;
        }
        total_matching += 1;
        if listed.len() < limit {
            listed.push(listed_company(company, props));
        }
    }
    tracing::Span::current().record("total_matching", total_matching);

    Ok(CompanyListing {
        companies: listed,
        total_matching,
    })
}

async fn read_companies<Crm: CrmService>(
    crm: &Crm,
    team: &CrmTeamReceipt<MemberTeamRole>,
    user_id: &MacroUserIdStr<'static>,
    hidden: bool,
) -> Result<Vec<CrmCompanyForSoup>, CrmError> {
    crm.list_companies_for_soup(
        team,
        user_id.0.as_ref(),
        &[],
        Some(hidden),
        CrmCompanyListSort::UpdatedAt,
        None,
        FETCH_LIMIT,
    )
    .await
}

fn non_blank(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn matches_search(company: &CrmCompanyForSoup, needle: &str) -> bool {
    company
        .name
        .as_deref()
        .is_some_and(|name| name.to_lowercase().contains(needle))
        || company
            .company
            .domains
            .iter()
            .any(|d| d.domain.to_lowercase().contains(needle))
}

fn listed_company(company: CrmCompanyForSoup, props: CompanyCrmProps) -> ListedCompany {
    ListedCompany {
        id: company.company.id,
        name: company.name,
        domains: company
            .company
            .domains
            .iter()
            .map(|d| d.domain.clone())
            .collect(),
        hidden: company.company.hidden,
        // The repository fills `updated_at` from
        // `crm_companies.last_interaction`.
        last_interaction: company.company.updated_at,
        stage: props.stage,
        owner_user_id: props.owner_user_id,
        revenue: props.revenue,
    }
}
