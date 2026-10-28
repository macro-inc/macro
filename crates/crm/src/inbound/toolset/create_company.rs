//! CreateCompany tool: manually add a company to the team CRM.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use properties::PropertiesService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::service::CrmService;

use super::{CrmToolContext, caller_team_receipt, crm_error};

/// The created company.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCompanyResponse {
    /// The new CRM company id (usable with GetCompany, CreateContact, and
    /// SetEntityProperty).
    pub company_id: Uuid,
    /// The company's display name.
    pub name: Option<String>,
    /// The company's domains.
    pub domains: Vec<String>,
}

/// Manually add a company to the caller's team CRM.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CreateCompany",
    description = "Add a company to the user's team CRM by name and web domain, as New Company in the CRM does. Companies a team emails are usually added automatically, so check ListCompanies first. Set its stage, owner, and other properties afterwards with SetEntityProperty (entity type company)."
)]
pub struct CreateCompany {
    /// Display name.
    #[schemars(description = "The company's display name, e.g. \"Acme\".")]
    pub name: String,
    /// Primary domain.
    #[schemars(
        description = "The company's web domain, e.g. \"acme.com\" — no scheme or path. Contacts are matched to the company by this domain."
    )]
    pub domain: String,
}

impl ToolAnnotated for CreateCompany {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Create CRM company");
}

#[async_trait]
impl<CSvc, ESvc, PSvc> AsyncTool<CrmToolContext<CSvc, ESvc, PSvc>> for CreateCompany
where
    CSvc: CrmService,
    ESvc: EntityAccessService,
    PSvc: PropertiesService,
{
    type Output = CreateCompanyResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CrmToolContext<CSvc, ESvc, PSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let (team, _) =
            caller_team_receipt(&*service_context.entity_access_service, &request_context).await?;
        let created = service_context
            .service
            .create_company(&team, self.name.trim(), self.domain.trim())
            .await
            .map_err(crm_error)?;

        Ok(CreateCompanyResponse {
            company_id: created.company.id,
            name: created.name,
            domains: created
                .company
                .domains
                .into_iter()
                .map(|domain| domain.domain)
                .collect(),
        })
    }
}
