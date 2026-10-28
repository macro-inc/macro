//! CreateContact tool: manually add a contact to a CRM company.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use properties::PropertiesService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::service::CrmService;

use super::{CrmToolContext, company_view_receipt, crm_error};

/// The created contact.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateContactResponse {
    /// The new CRM contact id.
    pub contact_id: Uuid,
    /// The company the contact belongs to.
    pub company_id: Uuid,
    /// The contact's email.
    pub email: String,
    /// The contact's display name.
    pub name: Option<String>,
}

/// Manually add a contact to a CRM company.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CreateContact",
    description = "Add a contact person to a company in the user's team CRM, as Add Contact on a company does. The email's domain must be one of the company's domains. Find the company with ListCompanies, or add it first with CreateCompany."
)]
pub struct CreateContact {
    /// Company to add the contact to.
    #[schemars(description = "The CRM company id to add the contact to.")]
    pub company_id: Uuid,
    /// Display name.
    #[schemars(description = "The contact's name.")]
    pub name: String,
    /// Email address.
    #[schemars(description = "The contact's email address, e.g. \"jane@acme.com\".")]
    pub email: String,
}

impl ToolAnnotated for CreateContact {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Create CRM contact");
}

#[async_trait]
impl<CSvc, ESvc, PSvc> AsyncTool<CrmToolContext<CSvc, ESvc, PSvc>> for CreateContact
where
    CSvc: CrmService,
    ESvc: EntityAccessService,
    PSvc: PropertiesService,
{
    type Output = CreateContactResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, company_id=%self.company_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CrmToolContext<CSvc, ESvc, PSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let (company, _) = company_view_receipt(
            &*service_context.entity_access_service,
            &request_context,
            self.company_id,
        )
        .await?;
        let contact = service_context
            .service
            .create_contact(&company, self.name.trim(), self.email.trim())
            .await
            .map_err(crm_error)?;

        Ok(CreateContactResponse {
            contact_id: contact.id,
            company_id: contact.company_id,
            email: contact.email,
            name: contact.name,
        })
    }
}
