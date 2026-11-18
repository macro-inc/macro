//! GraphQL adapter for a team-owned CRM contact.

use async_graphql::{ID, Object};
use graphql_common::GraphqlSoupEntityType;

use super::GraphqlEntityMetadata;
use models_soup::crm_contact::SoupCrmContact;

use super::{SoupCacheProjection, SoupEntityEdges, graphql_entity};

/// A CRM contact retains its original team record's global cache identity.
pub struct GraphqlSoupCrmContact<E: SoupEntityEdges>(
    pub(super) SoupCrmContact<()>,
    pub(super) E,
    pub(super) Option<f64>,
);

/// A team-owned CRM contact with its original record identity and shared Soup edges.
#[Object(name = "GraphqlSoupCrmContact")]
impl<E: SoupEntityEdges> GraphqlSoupCrmContact<E> {
    /// Original CRM contact ID.
    pub(super) async fn id(&self) -> ID {
        ID(self.0.id.to_string())
    }
    /// Canonical contact kind.
    pub(super) async fn entity_type(&self) -> GraphqlSoupEntityType {
        GraphqlSoupEntityType::CrmContact
    }
    /// Contacts do not use document cache projections.
    pub(super) async fn cache_projection(&self) -> Option<SoupCacheProjection> {
        None
    }
    /// Team-local name, falling back to the email address.
    pub(super) async fn display_name(&self) -> Option<String> {
        self.0
            .name
            .as_deref()
            .filter(|name| !name.trim().is_empty())
            .or(self.0.email.as_deref())
            .map(str::to_owned)
    }
    /// Record metadata; the parent is the owning company.
    pub(super) async fn metadata(&self) -> GraphqlEntityMetadata {
        GraphqlEntityMetadata {
            owner_id: None,
            owner_type: None,
            parent: self
                .0
                .company_id
                .map(|company_id| graphql_entity(model_entity::EntityType::CrmCompany, company_id)),
            created_at: Some(self.0.created_at.to_rfc3339()),
            updated_at: Some(self.0.updated_at.to_rfc3339()),
            viewed_at: self.0.viewed_at.map(|value| value.to_rfc3339()),
            deleted_at: None,
        }
    }
    /// Owning team.
    pub(super) async fn team_id(&self) -> ID {
        ID(self.0.team_id.to_string())
    }
    /// Parent company; null for a contact without a company.
    pub(super) async fn parent_company_id(&self) -> Option<ID> {
        self.0
            .company_id
            .map(|company_id| ID(company_id.to_string()))
    }
    /// Parent company's display name; null without a company.
    pub(super) async fn parent_company_name(&self) -> Option<&str> {
        self.0.company_name.as_deref()
    }
    /// Full email address; null for a contact added by name alone.
    pub(super) async fn email_address(&self) -> Option<&str> {
        self.0.email.as_deref()
    }
    /// Parent company, or the nil ID for a contact without a company.
    #[graphql(deprecation = "Use parentCompanyId. Remove after 2026-12-10.")]
    pub(super) async fn company_id(&self) -> ID {
        ID(self.0.company_id.unwrap_or_default().to_string())
    }
    /// Parent company's display name, or empty without a company.
    #[graphql(deprecation = "Use parentCompanyName. Remove after 2026-12-10.")]
    pub(super) async fn company_name(&self) -> &str {
        self.0.company_name.as_deref().unwrap_or_default()
    }
    /// Full email address, or empty for a contact added by name alone.
    #[graphql(deprecation = "Use emailAddress. Remove after 2026-12-10.")]
    pub(super) async fn email(&self) -> &str {
        self.0.email.as_deref().unwrap_or_default()
    }
    /// Team-local display name.
    pub(super) async fn name(&self) -> Option<&str> {
        self.0.name.as_deref()
    }
    /// Effective hidden state of the contact and its company.
    pub(super) async fn hidden(&self) -> bool {
        self.0.hidden
    }
    /// Earliest interaction with this contact on its owning team.
    pub(super) async fn first_interaction(&self) -> String {
        self.0.first_interaction.to_rfc3339()
    }
    /// Most recent interaction with this contact on its owning team.
    pub(super) async fn last_interaction(&self) -> String {
        self.0.last_interaction.to_rfc3339()
    }
    /// Record creation timestamp.
    pub(super) async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }
    /// Record update timestamp.
    pub(super) async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }
    /// Viewer visit timestamp.
    pub(super) async fn viewed_at(&self) -> Option<String> {
        self.0.viewed_at.map(|value| value.to_rfc3339())
    }
    /// Shared Soup edges, resolved lazily.
    #[graphql(flatten)]
    pub(super) async fn edges(&self) -> E {
        self.1.clone()
    }
    /// CRM-record fields, such as the pipeline rows referencing the contact.
    #[graphql(flatten)]
    pub(super) async fn crm_record_edges(&self) -> E::CrmRecordEdges {
        E::crm_record_edges(
            model_entity::EntityType::CrmContact.with_entity_string(self.0.id.to_string()),
        )
    }
    /// Optional viewer frecency score.
    pub(super) async fn frecency_score(&self) -> Option<f64> {
        self.2
    }
}
