//! Agent request for access to a vault item notification projection.

use async_graphql::{ID, SimpleObject};
use model_notifications::PasswordAccessRequestedMetadata;

/// Metadata for an agent's request for access to a team vault item.
#[derive(SimpleObject)]
pub struct GraphqlPasswordAccessRequestedMetadata {
    /// Request identifier.
    request_id: ID,
    /// Team owning the item.
    team_id: ID,
    /// Requested item identifier.
    item_id: ID,
    /// Item display name when the request was made.
    item_name: String,
}

impl From<PasswordAccessRequestedMetadata> for GraphqlPasswordAccessRequestedMetadata {
    fn from(value: PasswordAccessRequestedMetadata) -> Self {
        Self {
            request_id: ID(value.request_id.to_string()),
            team_id: ID(value.team_id.to_string()),
            item_id: ID(value.item_id.to_string()),
            item_name: value.item_name,
        }
    }
}
