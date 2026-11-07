//! GraphQL inbound adapter for listing AI routines (`ScheduledAction`).
#![deny(missing_docs)]

mod context;
mod objects;
mod query;

pub use context::ScheduledActionGraphqlContext;
pub use objects::GraphqlScheduledAction;
pub use query::resolve_scheduled_actions;

use async_graphql::ErrorExtensions;
use rootcause::Report;

pub(crate) fn unavailable(error: Report) -> async_graphql::Error {
    tracing::error!(error = ?error, "scheduled action list failed");
    async_graphql::Error::new("scheduled actions are unavailable").extend_with(|_, extensions| {
        extensions.set("code", "INTERNAL_SERVER_ERROR");
    })
}
