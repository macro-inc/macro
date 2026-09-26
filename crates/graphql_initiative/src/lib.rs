//! Typed GraphQL inbound adapter for initiatives and their task membership.
#![deny(missing_docs)]

mod context;
mod inputs;
mod mutation;
mod objects;
mod query;

#[cfg(test)]
mod test;

pub use context::{InitiativeAuthorizer, InitiativeGraphqlContext};
pub use inputs::{InitiativePageInput, InitiativeTasksInput};
pub use mutation::InitiativeMutationRoot;
pub use objects::{
    GraphqlInitiative, GraphqlInitiativePage, GraphqlInitiativeTasksPage,
    GraphqlTaskInitiativeReference,
};
pub use query::{
    resolve_initiative, resolve_initiative_tasks, resolve_initiatives,
    resolve_task_initiative_references,
};

use async_graphql::ErrorExtensions;
use initiative::domain::models::InitiativeError;

/// Preserve actionable domain failures while hiding infrastructure details.
fn graphql_error(error: InitiativeError) -> async_graphql::Error {
    let (message, code) = match error {
        InitiativeError::NotFound => ("initiative not found".to_string(), "NOT_FOUND"),
        InitiativeError::Unauthorized => ("unauthorized".to_string(), "FORBIDDEN"),
        InitiativeError::BadRequest(message) => (message, "BAD_USER_INPUT"),
        InitiativeError::Conflict(message) => (message, "CONFLICT"),
        InitiativeError::NameTooLong { max } => (
            format!("name must contain at most {max} characters"),
            "BAD_USER_INPUT",
        ),
        InitiativeError::Internal(error) => {
            tracing::error!(error=?error, "initiative GraphQL request failed");
            ("internal server error".to_string(), "INTERNAL_SERVER_ERROR")
        }
    };
    async_graphql::Error::new(message).extend_with(|_, extensions| {
        extensions.set("code", code);
    })
}
