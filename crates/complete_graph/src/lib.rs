//! Composition of the domain GraphQL adapter crates (`graphql_soup`,
//! `graphql_channel`, `graphql_properties`, `graphql_notification`, `graphql_email`,
//! `graphql_favorite`, `graphql_entity_mutation`) into the complete schema served by
//! `document_storage_service` and exported as SDL.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

/// Cross-domain fields composed onto Soup entities.
mod edges;
/// Complete schema types and construction helpers.
mod schema;
#[cfg(test)]
mod sdl_test;

pub use edges::{SoupEdges, SoupEmailThreadEdges};
pub use graphql_activity::{
    ActivityEdgeKey, ActivityEdgeLoad, ActivityFeedInput, ActivityFeedReader,
    ActivityOverviewInput, ActivityPortReader, ActivityReader, EntityActivityLoader,
    GraphqlActivityAction, GraphqlActivityDay, GraphqlActivityEntityRank, GraphqlActivityEvent,
    GraphqlActivityOverview, GraphqlActivityPage, NoOpActivityReader, SoupActivityEdgeReader,
    entity_activity_loader,
};
pub use graphql_channel::{
    ChannelActivityAuthorizer, ChannelActivityMutationService, ChannelMutationRoot,
    GraphqlChannelActivity, GraphqlChannelActivityType, NoOpChannelActivityMutationService,
    RecordChannelActivityInput,
};
pub use graphql_common::GraphqlRequestParts;
pub use graphql_email::{
    EmailContentKey, EmailContentLoad, EmailContentLoader, EmailMutationService,
    EmailServiceEmailContentReader, EmailThreadMetadataLoad, EmailThreadMetadataLoader,
    GraphqlEmailLabel, GraphqlEmailLink, GraphqlEmailLinkSettings, GraphqlEmailMutation,
    GraphqlEmailProvider, GraphqlEmailQuery, GraphqlEmailSyncStatus, MarkEmailThreadSeenInput,
    NoOpSoupEmailContentEdgeReader, SoupEmailContentEdgeReader, SoupEmailEdgeReader,
    SoupEmailThreadMetadataEdgeReader, UpdateEmailThreadLabelInput, email_content_loader,
    email_thread_metadata_loader,
};
pub use graphql_entity_mutation::{
    ChannelSharePolicyInput, DuplicateEntityInput, EntityMutationPayload, EntityMutationRoot,
    EntityRefInput, EntitySharePolicyInput, GraphqlEntityMutationError,
    GraphqlEntityMutationErrorCode, GraphqlEntityMutationResult, GraphqlLinkShare,
    GraphqlMutationError, GraphqlMutationSuccess, GraphqlSharePolicyOperation, MoveEntityInput,
    RenameEntityInput, UpdateEntitySharePolicyInput,
};
pub use graphql_favorite::{
    EntityFavoriteEdgeReader, EntityFavoriteLoader, FavoriteMutationRoot, GraphqlFavorite,
    NoOpFavoriteMutationService, ReorderFavoritesInput, entity_favorite_loader,
};
pub use graphql_notification::{
    EntityNotificationsLoader, GraphqlNotificationUpdateOperation, NoOpNotificationMutationService,
    NotificationMutationRoot, NotificationMutationService, SoupNotificationEdgeReader,
    UpdateNotificationsForEntityInput, UpdateNotificationsInput, entity_notifications_loader,
};
pub use graphql_permission::{
    EntityPermissionEdgeReader, EntityPermissionLoader, GraphqlAccessLevelPermission,
    GraphqlChannelParticipantRole, GraphqlChannelRolePermission, GraphqlChannelViewOnlyPermission,
    GraphqlEntityAccessLevel, GraphqlEntityPermission, GraphqlTeamRole, GraphqlTeamRolePermission,
    entity_permission_loader,
};
pub use graphql_properties::{
    EntityPropertiesLoader, EntityPropertyReader, EntityPropertyWriter, NoOpEntityPropertyReader,
    PropertiesEntityPropertyReader, PropertiesEntityPropertyWriter, PropertiesMutationRoot,
    entity_properties_loader,
};
pub use schema::{
    EmailThreadInput, SchemaOnlySoupSchema, SchemaOnlyState, SharedSoupSchema, SoupQueryRoot,
    SoupSchema, SoupSubscriptionRoot, build_schema, build_schema_from_arc, build_schema_from_arcs,
    build_schema_with_service, build_schema_with_services,
};
