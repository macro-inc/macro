//! GraphQL inbound adapter for Ideas: the authenticated user's feed, and
//! what they do with an idea.
#![deny(missing_docs)]

mod context;
mod mutation;
mod objects;
mod user_query;

pub use context::{IdeaFuture, IdeasGraphql, IdeasGraphqlContext};
pub use mutation::IdeasMutationRoot;
pub use objects::{
    GraphqlEntityIdea, GraphqlIdea, GraphqlIdeaCategory, GraphqlIdeaEntityAction, GraphqlIdeaFeed,
    GraphqlIdeaKind, GraphqlIdeaRun, GraphqlIdeaRunMode, GraphqlIdeaRunProgress, GraphqlIdeaState,
    GraphqlIdeaTarget, GraphqlPromptIdea, GraphqlRoutineIdea,
};
pub use user_query::GraphqlIdeasQuery;

use async_graphql::ErrorExtensions;
use ideas::domain::model::IdeaError;

/// Map an ideas failure to a generic message and an `extensions.code`:
/// `NOT_FOUND`, `FORBIDDEN` or `INTERNAL_SERVER_ERROR`. None is retryable:
/// a write that failed here did not commit.
pub(crate) fn idea_error(error: IdeaError) -> async_graphql::Error {
    let (code, message) = match error {
        IdeaError::NotFound => ("NOT_FOUND", "idea not found"),
        IdeaError::NotGenerating | IdeaError::Generating => {
            ("FORBIDDEN", "this caller may not read or act on ideas")
        }
        IdeaError::Internal(report) => {
            tracing::error!(error = ?report, "ideas call failed");
            ("INTERNAL_SERVER_ERROR", "ideas are unavailable")
        }
    };
    async_graphql::Error::new(message).extend_with(|_, extensions| {
        extensions.set("code", code);
    })
}

pub(crate) fn bad_input(message: &'static str) -> async_graphql::Error {
    async_graphql::Error::new(message).extend_with(|_, extensions| {
        extensions.set("code", "BAD_USER_INPUT");
    })
}
