#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]
//! GraphQL adapter for the activity system.
//!
//! Three read surfaces over the `activity_events` log:
//!
//! - the authenticated user's own feed ([`resolve_activity_feed`]), a
//!   keyset-paginated field on `GraphqlUser`;
//! - the authenticated user's trailing-year aggregate
//!   ([`resolve_activity_overview`]);
//! - a lazily-loaded `activity` edge on every Soup entity, batched across
//!   entities through [`EntityActivityLoader`] so it costs nothing when not
//!   selected and one query when it is.
//!
//! - the timeline of one database ([`resolve_database_activity`]) or form
//!   ([`resolve_form_activity`]), which are not Soup items and so are read by
//!   id behind a view receipt.
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
/// Trailing-year activity overview input, output, and resolver.
mod overview;
/// Realtime activity subscription root and patch union.
mod subscriptions;
/// The access-checked timeline of one database or form.
mod timeline;

pub use activity::{ActivitySubscriptionService, NoOpActivitySubscriptionService};
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
pub use overview::{
    ActivityOverviewInput, GraphqlActivityDay, GraphqlActivityEntityRank, GraphqlActivityOverview,
    resolve_activity_overview,
};
pub use subscriptions::{ActivitySubscriptionRoot, GraphqlActivityPatch, subscribe_to_activity};
pub use timeline::{resolve_database_activity, resolve_form_activity};
