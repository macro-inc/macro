//! GraphQL inbound adapter for the entity-access domain: current-viewer
//! permission schema types and the DataLoader-backed permission edge
//! attached to Soup entities.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

/// Lazy entity-permission edge loading and schema types.
mod permission;

pub use permission::{
    EntityPermissionEdgeReader, EntityPermissionKey, EntityPermissionLoader,
    GraphqlChannelParticipantRole, GraphqlEntityAccessLevel, GraphqlEntityPermission,
    GraphqlEntityPermissionKind, GraphqlTeamRole, NoOpEntityPermissionEdgeReader,
    entity_permission_loader, load_entity_permission,
};
