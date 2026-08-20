#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]
//! GraphQL adapter for the activity system.
//!
//! Two read surfaces over the `activity_events` log:
//!
//! - the authenticated user's own feed ([`resolve_activity_feed`]), a
//!   keyset-paginated field on `GraphqlUser`;
//! - a lazily-loaded `activity` edge on every Soup entity, batched across
//!   entities through [`EntityActivityLoader`] so it costs nothing when not
//!   selected and one query when it is.
//!
//! Items carry `entityType`/`entityId` references only — clients resolve
//! entity names from their normalized Soup cache rather than hydrating
//! entities here.

/// The viewer activity feed: input, page, cursor codec, resolver.
mod feed;
/// Edge reader traits, the entity-activity DataLoader, and its readers.
mod loaders;
/// GraphQL objects for activity events and the typed action union.
mod objects;

pub use feed::{
    ActivityFeedInput, DEFAULT_ACTIVITY_FEED_LIMIT, GraphqlActivityPage, MAX_ACTIVITY_FEED_LIMIT,
    resolve_activity_feed,
};
pub use loaders::{
    ActivityEdgeKey, ActivityEdgeLoad, ActivityFeedReader, ActivityPortReader, ActivityReadFailed,
    ActivityReader, DEFAULT_ACTIVITY_EDGE_LIMIT, EntityActivityLoader, MAX_ACTIVITY_EDGE_LIMIT,
    NoOpActivityReader, SoupActivityEdgeReader, entity_activity_loader, load_entity_activity,
    parse_activity_edge_limit,
};
pub use objects::{GraphqlActivityAction, GraphqlActivityEvent};
