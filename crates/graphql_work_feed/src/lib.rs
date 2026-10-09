//! GraphQL inbound adapter for the work feed: the `workFeed` page under the
//! viewer, the done and undo mutations, and the `workFeedUpdates`
//! subscription. The schema itself is composed by `complete_graph`.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

/// Request data carrying the work feed service, triggers and viewer lookup.
mod context;
/// Feed, scope and mutation inputs.
mod inputs;
/// Done and undo mutations.
mod mutations;
/// Page, entry, item, stack and patch objects.
mod objects;
/// The `workFeed` page resolver.
mod query;
/// The `workFeedUpdates` subscription.
mod subscriptions;

pub use context::{
    EntityAccessWorkFeedViewers, WorkFeedGraphqlContext, WorkFeedGraphqlService,
    WorkFeedViewerResolver,
};
pub use inputs::{
    GraphqlWorkFeedItemType, GraphqlWorkFeedMode, MarkWorkFeedItemsDoneInput,
    UndoWorkFeedItemsDoneInput, WorkFeedDoneItemInput, WorkFeedInput, WorkFeedScopeInput,
};
pub use mutations::{
    MarkWorkFeedItemsDonePayload, UndoWorkFeedItemsDonePayload, WorkFeedMutationRoot,
};
pub use objects::{
    GraphqlWorkFeedEntry, GraphqlWorkFeedItem, GraphqlWorkFeedPage, GraphqlWorkFeedPatch,
    GraphqlWorkFeedStack,
};
pub use query::resolve_work_feed;
pub use subscriptions::WorkFeedSubscriptionRoot;
