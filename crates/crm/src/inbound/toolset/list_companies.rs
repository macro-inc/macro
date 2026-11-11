//! ListCompanies tool for browsing the caller team's CRM companies.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::ports::EntityAccessService;
use properties::PropertiesService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{
    company_listing::{CompanyListQuery, CompanyListingError, ListedCompany, list_companies},
    service::CrmService,
};

use super::{CrmToolContext, ToolCompanyStage, caller_team_receipt, crm_error};

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
    /// The company's own Stage property, if set; separate from any
    /// pipeline entry's stage.
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
    description = "List the CRM companies tracked by the authenticated user's team, sorted by most recent interaction. Each row includes the company id, name, domains, last interaction time, and the company's own Stage / Owner / Revenue properties when set (not a pipeline deal's). Use the filters to narrow results: `search` for name/domain text, `stage` for the company's own Stage property, `owner_user_id` for companies owned by a user. Use GetCompany for one company's full details (contacts + all properties), and SetEntityProperty with entity_type=company to change the company's own Stage / Owner / Revenue or custom properties. Deals in a pipeline have their own stage and fields, separate from these: use FindPipelineEntries and UpdatePipelineEntries for them."
)]
pub struct ListCompanies {
    /// Case-insensitive substring matched against company names and domains.
    #[schemars(
        description = "Case-insensitive substring matched against company names and domains (e.g. \"acme\" matches \"Acme Corp\" and \"acme.com\")."
    )]
    #[serde(default)]
    pub search: Option<String>,

    /// Filter to companies whose own Stage property is this (label or option id).
    #[schemars(
        description = "Filter to companies whose own Stage property (not a pipeline deal's stage) is this. Accepts a stage label matched case-insensitively (e.g. \"lead\", \"Customer\" — teams may have custom stage names) or a stage option UUID."
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

impl ToolAnnotated for ListCompanies {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("List companies");
}

#[async_trait]
impl<CSvc, ESvc, PSvc> AsyncTool<CrmToolContext<CSvc, ESvc, PSvc>> for ListCompanies
where
    CSvc: CrmService,
    ESvc: EntityAccessService,
    PSvc: PropertiesService,
{
    type Output = ListCompaniesResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CrmToolContext<CSvc, ESvc, PSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "List CRM companies");

        let (team_receipt, _role) =
            caller_team_receipt(&*service_context.entity_access_service, &request_context).await?;
        let listing = list_companies(
            &*service_context.service,
            &*service_context.properties,
            &team_receipt,
            &CompanyListQuery {
                search: self.search.clone(),
                stage: self.stage.clone(),
                owner_user_id: self.owner_user_id.clone(),
                include_hidden: self.include_hidden.unwrap_or(false),
                limit: self.limit,
            },
        )
        .await
        .map_err(listing_error)?;

        let shown = listing.companies.len();
        let summary = if shown == 0 {
            "No CRM companies match the given filters.".to_string()
        } else if listing.total_matching > shown {
            format!(
                "Showing {shown} of {} matching CRM companies (sorted by most recent interaction). Narrow with search/stage/owner filters or raise limit.",
                listing.total_matching
            )
        } else {
            format!(
                "Found {shown} CRM compan{} (sorted by most recent interaction).",
                if shown == 1 { "y" } else { "ies" }
            )
        };

        Ok(ListCompaniesResponse {
            companies: listing.companies.into_iter().map(Into::into).collect(),
            summary,
        })
    }
}

fn listing_error(error: CompanyListingError) -> ToolCallError {
    match error {
        CompanyListingError::Crm(error) => crm_error(error),
        error @ (CompanyListingError::HiddenRequiresAdmin
        | CompanyListingError::UnknownStage { .. }) => ToolCallError {
            description: error.to_string(),
            internal_error: error.into(),
        },
        CompanyListingError::Properties(error) => ToolCallError {
            description: "failed to load company properties".to_string(),
            internal_error: error.into(),
        },
    }
}

impl From<ListedCompany> for CompanyListItem {
    fn from(company: ListedCompany) -> Self {
        Self {
            id: company.id,
            name: company.name,
            domains: company.domains,
            hidden: company.hidden,
            last_interaction: company.last_interaction,
            stage: company.stage.map(Into::into),
            owner_user_id: company.owner_user_id,
            revenue: company.revenue,
        }
    }
}
