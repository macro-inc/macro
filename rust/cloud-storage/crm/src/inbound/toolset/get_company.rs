//! GetCompany tool for reading a single CRM company's details.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::{
    models::{AccessError, Entity, EntityAccessReceipt, EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::{DataType, EntityType as PropertyEntityType};
use properties::PropertiesService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{
    auth::CrmCompanyReceipt,
    model::{CrmContact, CrmError},
    service::CrmService,
};

use super::{
    CrmToolContext, ToolCompanyStage, crm_error, extract_company_crm_props,
    load_stage_option_catalog,
};

/// A contact belonging to the company.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompanyContactItem {
    /// The CRM contact id.
    pub id: Uuid,
    /// The contact's email address.
    pub email: String,
    /// The contact's display name, when known.
    pub name: Option<String>,
    /// Most recent known interaction with this contact.
    pub last_interaction: DateTime<Utc>,
}

impl From<CrmContact> for CompanyContactItem {
    fn from(contact: CrmContact) -> Self {
        Self {
            id: contact.id,
            email: contact.email,
            name: contact.name,
            last_interaction: contact.last_interaction,
        }
    }
}

/// An option available on a select-type company property.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompanyPropertyOption {
    /// The option id to use when setting select values via SetEntityProperty.
    pub id: Uuid,
    /// The option's display value.
    pub display_value: String,
}

/// A property attached to the company (builtin or custom).
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompanyPropertyItem {
    /// The property definition id. Use with SetEntityProperty (entity_type=company).
    pub property_definition_id: Uuid,
    /// Human-readable property name.
    pub display_name: String,
    /// The data type (boolean, date, number, string, select_string, select_number, tag, entity, link).
    pub data_type: String,
    /// Whether the property supports multiple values.
    pub is_multi_select: bool,
    /// Whether this is a system-defined property.
    pub is_system: bool,
    /// The current value, if set.
    pub current_value: Option<serde_json::Value>,
    /// Available options for select-type properties.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<CompanyPropertyOption>,
}

/// Response from the [`GetCompany`] tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetCompanyResponse {
    /// The CRM company id.
    pub id: Uuid,
    /// Company display name, when resolved.
    pub name: Option<String>,
    /// Short company description, when resolved.
    pub description: Option<String>,
    /// The company's email domains, primary domain first.
    pub domains: Vec<String>,
    /// Whether the company is hidden from the team's CRM listings.
    pub hidden: bool,
    /// Whether team-wide email sharing is enabled for this company.
    pub email_sync: bool,
    /// Earliest known email interaction with this company.
    pub first_interaction: DateTime<Utc>,
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
    /// Contacts attached to this company.
    pub contacts: Vec<CompanyContactItem>,
    /// All properties attached to this company (builtin Stage / Owner /
    /// Revenue plus custom ones), with current values and select options.
    pub properties: Vec<CompanyPropertyItem>,
    /// Human-readable summary.
    pub summary: String,
}

/// Fetch one CRM company by id.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(
    title = "GetCompany",
    description = "Fetch one of the team's CRM companies by id, with its domains, contacts, pipeline Stage / Owner / Revenue, and all attached property values (including custom properties and the valid stage options). Use ListCompanies to find company ids. To change a property (move stage, set owner/revenue, or edit a custom property) call SetEntityProperty with entity_type=company, the company id, and a property_definition_id / option id from this response."
)]
pub struct GetCompany {
    /// The CRM company id to fetch.
    #[schemars(description = "The CRM company id (UUID), e.g. from ListCompanies.")]
    pub company_id: Uuid,
}

#[async_trait]
impl<CSvc, ESvc, PSvc> AsyncTool<CrmToolContext<CSvc, ESvc, PSvc>> for GetCompany
where
    CSvc: CrmService,
    ESvc: EntityAccessService,
    PSvc: PropertiesService,
{
    type Output = GetCompanyResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, company_id=%self.company_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CrmToolContext<CSvc, ESvc, PSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "Get CRM company");

        let company_id = self.company_id.to_string();

        // Resolve the caller's permission on this company (derived from
        // their role on the owning team). Access failures collapse to
        // "not found" so company ids can't be probed across teams.
        let (permission, team_id) = match service_context
            .entity_access_service
            .get_crm_entity_permission_with_team(
                Some(&request_context.user_id),
                &company_id,
                EntityType::CrmCompany,
            )
            .await
        {
            Ok(pair) => pair,
            Err(
                AccessError::Unauthorized
                | AccessError::UnauthorizedWithMessage(_)
                | AccessError::NotFound(_),
            ) => return Err(not_found()),
            Err(e) => {
                return Err(ToolCallError {
                    description: "failed to verify access to the CRM company".to_string(),
                    internal_error: e.into(),
                });
            }
        };

        if !permission.satisfies::<ViewAccessLevel>() {
            return Err(not_found());
        }

        let receipt = EntityAccessReceipt::try_new_authenticated_user(
            request_context.user_id.clone(),
            Entity {
                entity_id: company_id.clone(),
                entity_type: EntityType::CrmCompany,
            },
            permission,
        )
        .map_err(|e| ToolCallError {
            description: "failed to verify access to the CRM company".to_string(),
            internal_error: e.into(),
        })?;
        let receipt = CrmCompanyReceipt::new(receipt, team_id);

        let record = service_context
            .service
            .get_company_for_team(&receipt)
            .await
            .map_err(crm_error)?
            .ok_or_else(|| crm_error(CrmError::CompanyNotFoundForTeam))?;

        let properties = service_context
            .properties
            .get_entity_properties_with_definitions(&company_id, PropertyEntityType::Company)
            .await
            .map_err(|e| ToolCallError {
                description: "failed to load company properties".to_string(),
                internal_error: e.into(),
            })?;

        let stage_catalog =
            load_stage_option_catalog(&*service_context.properties, team_id).await?;
        let crm_props = extract_company_crm_props(&properties, &stage_catalog);

        let name = record.name.clone();
        let summary = format!(
            "CRM company {}{} with {} contact{}, {} propert{}.",
            name.as_deref().unwrap_or("(unnamed)"),
            crm_props
                .stage
                .as_ref()
                .map(|s| format!(" in stage {}", s.label))
                .unwrap_or_default(),
            record.contacts.len(),
            if record.contacts.len() == 1 { "" } else { "s" },
            properties.len(),
            if properties.len() == 1 { "y" } else { "ies" },
        );

        Ok(GetCompanyResponse {
            id: record.company.id,
            name,
            description: record.description,
            domains: record
                .company
                .domains
                .iter()
                .map(|d| d.domain.clone())
                .collect(),
            hidden: record.company.hidden,
            email_sync: record.company.email_sync,
            // The repo fills `company.created_at` / `updated_at` from
            // `crm_companies.first_interaction` / `last_interaction`, so
            // these really are the interaction endpoints, not
            // row-lifecycle timestamps.
            first_interaction: record.company.created_at,
            last_interaction: record.company.updated_at,
            stage: crm_props.stage,
            owner_user_id: crm_props.owner_user_id,
            revenue: crm_props.revenue,
            contacts: record.contacts.into_iter().map(Into::into).collect(),
            properties: properties.into_iter().map(to_property_item).collect(),
            summary,
        })
    }
}

fn not_found() -> ToolCallError {
    ToolCallError {
        description: "CRM company not found or not accessible to the caller's team".to_string(),
        internal_error: anyhow::anyhow!("crm company not found or not accessible"),
    }
}

fn to_property_item(prop: EntityPropertyWithDefinition) -> CompanyPropertyItem {
    let data_type = match prop.definition.data_type {
        DataType::Boolean => "boolean",
        DataType::Date => "date",
        DataType::Number => "number",
        DataType::String => "string",
        DataType::SelectNumber => "select_number",
        DataType::SelectString => "select_string",
        DataType::Tag => "tag",
        DataType::Entity => "entity",
        DataType::Link => "link",
    }
    .to_string();

    let current_value = prop
        .value
        .as_ref()
        .map(|v| serde_json::to_value(v).unwrap_or(serde_json::Value::Null));

    let options = prop
        .options
        .unwrap_or_default()
        .into_iter()
        .map(|option| CompanyPropertyOption {
            id: option.id,
            display_value: match option.value {
                PropertyOptionValue::String(s) => s,
                PropertyOptionValue::Number(n) => n.to_string(),
            },
        })
        .collect();

    CompanyPropertyItem {
        property_definition_id: prop.property.property_definition_id,
        display_name: prop.definition.display_name,
        data_type,
        is_multi_select: prop.definition.is_multi_select,
        is_system: prop.definition.is_system,
        current_value,
        options,
    }
}
