//! AddCompanyDomain and RemoveCompanyDomain tools: change the domains a CRM
//! company is known by.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::{models::EditAccessLevel, ports::EntityAccessService};
use properties::PropertiesService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{model::CrmCompanyWithContacts, service::CrmService};

use super::{CrmToolContext, company_receipt, crm_error};

/// The company after the change.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompanyDomainsResponse {
    /// The CRM company id.
    pub company_id: Uuid,
    /// The company's display name, which a domain change never alters.
    pub name: Option<String>,
    /// The company's domains, primary first.
    pub domains: Vec<String>,
}

impl From<CrmCompanyWithContacts> for CompanyDomainsResponse {
    fn from(company: CrmCompanyWithContacts) -> Self {
        Self {
            company_id: company.company.id,
            name: company.name,
            domains: company
                .company
                .domains
                .into_iter()
                .map(|domain| domain.domain)
                .collect(),
        }
    }
}

/// Add a domain to a CRM company.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "AddCompanyDomain",
    description = "Add another web domain an organization uses (a school's .edu and .com, say) to an existing CRM company, so its mail and new contacts are filed under that company instead of a separate one. The company keeps its name and primary domain. Refused for personal email providers, and for a domain another company of the team already tracks: the error names that company. Safe to repeat."
)]
pub struct AddCompanyDomain {
    /// The company to add the domain to.
    #[schemars(description = "The CRM company id, from ListCompanies or GetCompany.")]
    pub company_id: Uuid,
    /// The domain to add.
    #[schemars(description = "A bare domain such as \"example.org\": no scheme, path or email.")]
    pub domain: String,
}

impl ToolAnnotated for AddCompanyDomain {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::additive("Add CRM company domain").with_idempotent();
}

#[async_trait]
impl<CSvc, ESvc, PSvc> AsyncTool<CrmToolContext<CSvc, ESvc, PSvc>> for AddCompanyDomain
where
    CSvc: CrmService,
    ESvc: EntityAccessService,
    PSvc: PropertiesService,
{
    type Output = CompanyDomainsResponse;

    #[tracing::instrument(skip_all, fields(company_id = %self.company_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CrmToolContext<CSvc, ESvc, PSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let (company, _) = company_receipt::<EditAccessLevel, _>(
            &*service_context.entity_access_service,
            &request_context,
            self.company_id,
        )
        .await?;
        let updated = service_context
            .service
            .add_company_domain(&company, &self.domain)
            .await
            .map_err(crm_error)?;
        Ok(updated.into())
    }
}

/// Remove a domain from a CRM company.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "RemoveCompanyDomain",
    description = "Remove a web domain from a CRM company, for one added by mistake. Contacts and mail stay; later mail from the domain is filed as it was before the domain was added. The domain the company is named after stays until the company is renamed. Removing a domain from a company whose email sync is off needs a team admin. Safe to repeat."
)]
pub struct RemoveCompanyDomain {
    /// The company to remove the domain from.
    #[schemars(description = "The CRM company id, from ListCompanies or GetCompany.")]
    pub company_id: Uuid,
    /// The domain to remove.
    #[schemars(description = "One of the company's domains, such as \"example.org\".")]
    pub domain: String,
}

impl ToolAnnotated for RemoveCompanyDomain {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Remove CRM company domain").with_idempotent();
}

#[async_trait]
impl<CSvc, ESvc, PSvc> AsyncTool<CrmToolContext<CSvc, ESvc, PSvc>> for RemoveCompanyDomain
where
    CSvc: CrmService,
    ESvc: EntityAccessService,
    PSvc: PropertiesService,
{
    type Output = CompanyDomainsResponse;

    #[tracing::instrument(skip_all, fields(company_id = %self.company_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CrmToolContext<CSvc, ESvc, PSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let (company, _) = company_receipt::<EditAccessLevel, _>(
            &*service_context.entity_access_service,
            &request_context,
            self.company_id,
        )
        .await?;
        let updated = service_context
            .service
            .remove_company_domain(&company, &self.domain)
            .await
            .map_err(crm_error)?;
        Ok(updated.into())
    }
}
