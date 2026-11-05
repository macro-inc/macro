//! GraphQL inbound adapter for registered work: the `registeredWork` list
//! under the viewer and the `registeredWorkUpdates` subscription. The schema
//! itself is composed by `complete_graph`.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

/// Request data carrying registrations and the viewer's session changes.
mod context;
/// Account id input validation.
mod inputs;
/// Registration and patch objects.
mod objects;
/// The `registeredWork` resolver.
mod query;
/// The `registeredWorkUpdates` subscription.
mod subscriptions;

pub use context::{RegisteredWorkGraphqlContext, RegisteredWorkGraphqlService};
pub use objects::{
    GraphqlRegisteredWork, GraphqlRegisteredWorkInvalidate, GraphqlRegisteredWorkPatch,
    GraphqlRegisteredWorkRemove, GraphqlRegisteredWorkUpsert,
};
pub use query::resolve_registered_work;
pub use subscriptions::RegisteredWorkSubscriptionRoot;
