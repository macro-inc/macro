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
        Some(
            self.0
                .name
                .as_deref()
                .filter(|name| !name.trim().is_empty())
                .unwrap_or(&self.0.email)
                .to_owned(),
        )
    }
    /// Record metadata; the parent is the owning company.
    pub(super) async fn metadata(&self) -> GraphqlEntityMetadata {
        GraphqlEntityMetadata {
            owner_id: None,
            owner_type: None,
            parent: Some(graphql_entity(
                model_entity::EntityType::CrmCompany,
                self.0.company_id,
            )),
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
    /// Parent company.
    pub(super) async fn company_id(&self) -> ID {
        ID(self.0.company_id.to_string())
    }
    /// Parent company's display name.
    pub(super) async fn company_name(&self) -> &str {
        &self.0.company_name
    }
    /// Full email address.
    pub(super) async fn email(&self) -> &str {
        &self.0.email
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
    /// Optional viewer frecency score.
    pub(super) async fn frecency_score(&self) -> Option<f64> {
        self.2
    }
}
