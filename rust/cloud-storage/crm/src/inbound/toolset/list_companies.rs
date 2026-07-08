//! ListCompanies tool for browsing the caller team's CRM companies.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::{models::TeamRole, ports::EntityAccessService};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use system_properties::SystemPropertyKey;
use uuid::Uuid;

use crate::domain::{
    companies_repo::CrmCompanyListSort, model::CrmCompanyForSoup, service::CrmService,
};

use super::{
    CrmToolContext, ToolCompanyStage, caller_team_receipt, company_entity_refs, crm_error,
    extract_company_crm_props, load_stage_option_catalog,
};

/// Default number of companies returned when `limit` is omitted.
const DEFAULT_LIMIT: u16 = 50;
/// Maximum number of companies a single call can return.
const MAX_LIMIT: u16 = 200;
/// How many companies are pulled from the repository before in-memory
/// filtering. Matches the CRM request cap used by the app (a team's CRM
/// list is capped around 500 rows per page).
const FETCH_LIMIT: i64 = 500;

/// A CRM company row returned by [`ListCompanies`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompanyListItem {
    /// The CRM company id. Use with GetCompany, GetEntityProperties /
    /// SetEntityProperty (entity_type=company).
    pub id: Uuid,
    /// Company display name, when resolved.
    pub name: Option<String>,
    /// The company's email domains, primary domain first.
    pub domains: Vec<String>,
    /// Whether the company is hidden from the team's CRM listings.
    pub hidden: bool,
    /// Most recent known email interaction with this company.
    pub last_interaction: DateTime<Utc>,
    /// The company's pipeline stage, if set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<ToolCompanyStage>,
    /// Macro user id of the company's owner, if set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_user_id: Option<String>,
    /// The company's revenue (dollars), if set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revenue: Option<f64>,
}

/// Response from the [`ListCompanies`] tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListCompaniesResponse {
    /// The matching CRM companies.
    pub companies: Vec<CompanyListItem>,
    /// Human-readable summary of the results.
    pub summary: String,
}

/// List the caller team's CRM companies.
#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
#[schemars(
    title = "ListCompanies",
    description = "List the CRM companies tracked by the authenticated user's team, sorted by most recent interaction. Each row includes the company id, name, domains, last interaction time, and its pipeline Stage / Owner / Revenue properties when set. Use the filters to narrow results: `search` for name/domain text, `stage` for pipeline stage, `owner_user_id` for companies owned by a user. Use GetCompany for one company's full details (contacts + all properties), and SetEntityProperty with entity_type=company to move stages or update owner/revenue/custom properties."
)]
pub struct ListCompanies {
    /// Case-insensitive substring matched against company names and domains.
    #[schemars(
        description = "Case-insensitive substring matched against company names and domains (e.g. \"acme\" matches \"Acme Corp\" and \"acme.com\")."
    )]
    #[serde(default)]
    pub search: Option<String>,

    /// Filter to companies in this pipeline stage (label or option id).
    #[schemars(
        description = "Filter to companies in this pipeline stage. Accepts a stage label matched case-insensitively (e.g. \"lead\", \"Customer\" — teams may have custom stage names) or a stage option UUID."
    )]
    #[serde(default)]
    pub stage: Option<String>,

    /// Filter to companies owned by this Macro user id.
    #[schemars(
        description = "Filter to companies whose Owner property is this Macro user id (e.g. \"macro|user@example.com\"). Use ListTeamMembers to find user ids."
    )]
    #[serde(default)]
    pub owner_user_id: Option<String>,

    /// Also include hidden companies (team admin/owner only).
    #[schemars(
        description = "Also include companies hidden from the CRM. Defaults to false. Requires team admin or owner role."
    )]
    #[serde(default)]
    pub include_hidden: Option<bool>,

    /// Maximum number of companies to return (default 50, max 200).
    #[schemars(description = "Maximum number of companies to return. Defaults to 50; max 200.")]
    #[serde(default)]
    pub limit: Option<u16>,
}

#[async_trait]
impl<CSvc, ESvc> AsyncTool<CrmToolContext<CSvc, ESvc>> for ListCompanies
where
    CSvc: CrmService,
    ESvc: EntityAccessService,
{
    type Output = ListCompaniesResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CrmToolContext<CSvc, ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "List CRM companies");

        let (team_receipt, role) =
            caller_team_receipt(&*service_context.entity_access_service, &request_context).await?;
        let team_id = team_receipt.team_id();

        let include_hidden = self.include_hidden.unwrap_or(false);
        if include_hidden && !matches!(role, TeamRole::Admin | TeamRole::Owner) {
            return Err(ToolCallError {
                description: "include_hidden requires team admin or owner role".to_string(),
                internal_error: anyhow::anyhow!("caller is not a team admin/owner"),
            });
        }

        let limit = usize::from(self.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT));
        let user_id: &str = request_context.user_id.0.as_ref();

        // Fetch visible companies (and hidden ones when requested), most
        // recently active first, then filter in memory.
        let mut companies = service_context
            .service
            .list_companies_for_soup(
                &team_receipt,
                user_id,
                &[],
                Some(false),
                CrmCompanyListSort::UpdatedAt,
                None,
                FETCH_LIMIT,
            )
            .await
            .map_err(crm_error)?;
        if include_hidden {
            let hidden = service_context
                .service
                .list_companies_for_soup(
                    &team_receipt,
                    user_id,
                    &[],
                    Some(true),
                    CrmCompanyListSort::UpdatedAt,
                    None,
                    FETCH_LIMIT,
                )
                .await
                .map_err(crm_error)?;
            companies.extend(hidden);
            companies.sort_by(|a, b| {
                b.company
                    .updated_at
                    .cmp(&a.company.updated_at)
                    .then_with(|| b.company.id.cmp(&a.company.id))
            });
        }

        // Text filter first so the property fetch only covers candidates.
        if let Some(search) = self
            .search
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let needle = search.to_lowercase();
            companies.retain(|c| matches_search(c, &needle));
        }

        let stage_catalog = load_stage_option_catalog(&service_context.pool, team_id).await?;

        // Resolve the stage filter to option ids up front so an unknown
        // stage fails with an actionable error instead of an empty list.
        let stage_option_ids = match self
            .stage
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(stage) => {
                let ids = stage_catalog.matching_option_ids(stage);
                if ids.is_empty() {
                    return Err(ToolCallError {
                        description: format!(
                            "unknown stage '{stage}'. Known stages for this team: {}",
                            stage_catalog.known_labels().join(", ")
                        ),
                        internal_error: anyhow::anyhow!("unknown stage filter"),
                    });
                }
                Some(ids)
            }
            None => None,
        };

        // Attach Stage / Owner / Revenue for the remaining candidates.
        // Teams with customized pipelines store stage values under a
        // team-scoped "Stage" definition rather than the system one, so
        // include those definition ids in the fetch filter too.
        let entity_refs = company_entity_refs(companies.iter().map(|c| c.company.id));
        let mut property_ids = vec![
            SystemPropertyKey::STAGE_UUID,
            SystemPropertyKey::COMPANY_OWNER_UUID,
            SystemPropertyKey::REVENUE_UUID,
        ];
        property_ids.extend_from_slice(stage_catalog.team_stage_definition_ids());
        let properties_map =
            properties_db_client::entity_properties::get::get_bulk_entity_properties_values_filtered(
                &service_context.pool,
                &entity_refs,
                &property_ids,
                None,
            )
            .await
            .map_err(|e| ToolCallError {
                description: "failed to load company properties".to_string(),
                internal_error: e.into(),
            })?;

        let mut items: Vec<CompanyListItem> = Vec::new();
        let mut total_matching = 0usize;
        for company in companies {
            let props = properties_map
                .get(&company.company.id.to_string())
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            let crm_props = extract_company_crm_props(props, &stage_catalog);

            if let Some(stage_ids) = &stage_option_ids {
                let matches_stage = crm_props
                    .stage
                    .as_ref()
                    .is_some_and(|stage| stage_ids.contains(&stage.option_id));
                if !matches_stage {
                    continue;
                }
            }
            if let Some(owner_filter) = self
                .owner_user_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                let matches_owner = crm_props
                    .owner_user_id
                    .as_deref()
                    .is_some_and(|owner| owner.eq_ignore_ascii_case(owner_filter));
                if !matches_owner {
                    continue;
                }
            }

            total_matching += 1;
            if items.len() < limit {
                items.push(to_list_item(company, crm_props));
            }
        }

        let summary = if items.is_empty() {
            "No CRM companies match the given filters.".to_string()
        } else if total_matching > items.len() {
            format!(
                "Showing {} of {} matching CRM companies (sorted by most recent interaction). Narrow with search/stage/owner filters or raise limit.",
                items.len(),
                total_matching
            )
        } else {
            format!(
                "Found {} CRM compan{} (sorted by most recent interaction).",
                items.len(),
                if items.len() == 1 { "y" } else { "ies" }
            )
        };

        Ok(ListCompaniesResponse {
            companies: items,
            summary,
        })
    }
}

fn matches_search(company: &CrmCompanyForSoup, needle: &str) -> bool {
    if company
        .name
        .as_deref()
        .is_some_and(|name| name.to_lowercase().contains(needle))
    {
        return true;
    }
    company
        .company
        .domains
        .iter()
        .any(|d| d.domain.to_lowercase().contains(needle))
}

fn to_list_item(company: CrmCompanyForSoup, props: super::CompanyCrmProps) -> CompanyListItem {
    CompanyListItem {
        id: company.company.id,
        name: company.name,
        domains: company
            .company
            .domains
            .iter()
            .map(|d| d.domain.clone())
            .collect(),
        hidden: company.company.hidden,
        // The repo fills `company.updated_at` from
        // `crm_companies.last_interaction`, so this really is the latest
        // email interaction, not a row-lifecycle timestamp.
        last_interaction: company.company.updated_at,
        stage: props.stage,
        owner_user_id: props.owner_user_id,
        revenue: props.revenue,
    }
}
