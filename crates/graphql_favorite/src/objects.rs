use async_graphql::{ID, Object};
use favorites::domain::models::Favorite;
use graphql_common::GraphqlEntityType;

/// An entity in the authenticated user's ordered favorites collection.
pub struct GraphqlFavorite(Favorite);

impl GraphqlFavorite {
    /// Construct a GraphQL favorite from its domain model.
    pub fn new(favorite: Favorite) -> Self {
        Self(favorite)
    }
}

/// GraphQL fields for an ordered favorite.
#[Object]
impl GraphqlFavorite {
    /// Canonical type of the favorited entity.
    async fn entity_type(&self) -> GraphqlEntityType {
        GraphqlEntityType::new(self.0.entity_type)
    }

    /// Canonical identifier of the favorited entity.
    async fn entity_id(&self) -> ID {
        ID(self.0.entity_id.clone())
    }

    /// Manual ordering value; lower values sort first.
    async fn sort_order(&self) -> f64 {
        self.0.sort_order
    }

    /// Time at which the entity was first favorited, in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    /// File type of a favorited document, when applicable.
    async fn file_type(&self) -> Option<&str> {
        self.0.file_type.as_deref()
    }

    /// Document subtype of a favorited document, when applicable.
    async fn document_sub_type(&self) -> Option<&str> {
        self.0.document_sub_type.as_deref()
    }

    /// Channel type of a favorited channel, when applicable.
    async fn channel_type(&self) -> Option<&str> {
        self.0.channel_type.as_deref()
    }

    /// Owning channel id of a favorited channel message, when applicable.
    async fn channel_id(&self) -> Option<ID> {
        self.0.channel_id.clone().map(ID)
    }
}
